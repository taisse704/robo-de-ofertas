import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configurados nos secrets do GitHub.");
}

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: "Bearer " + SERVICE_ROLE_KEY,
  "Content-Type": "application/json"
};

async function rest(path, options = {}) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error("Supabase " + response.status + ": " + (data?.message || text.slice(0, 500)));
  return data;
}

function safeName(value) {
  return String(value || "oferta").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "oferta";
}

async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Imagem indisponível: HTTP " + r.status);
  const bytes = new Uint8Array(await r.arrayBuffer());
  writeFileSync(file, bytes);
}

async function upload(path, file) {
  const bytes = readFileSync(file);
  const r = await fetch(SUPABASE_URL + "/storage/v1/object/videos/" + path.split("/").map(encodeURIComponent).join("/"), {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: "Bearer " + SERVICE_ROLE_KEY,
      "Content-Type": "video/mp4",
      "x-upsert": "true"
    },
    body: bytes
  });
  if (!r.ok) throw new Error("Storage " + r.status + ": " + (await r.text()).slice(0, 500));
  return SUPABASE_URL + "/storage/v1/object/public/videos/" + path.split("/").map(encodeURIComponent).join("/");
}

// Renderizador automático de vídeos do Robô de Ofertas.
async function main() {
  const jobs = await rest("video_jobs?status=eq.pendente&order=created_at.asc&limit=3&select=*");
  if (!Array.isArray(jobs) || !jobs.length) {
    console.log("Nenhum vídeo pendente.");
    return;
  }

  for (const job of jobs) {
    const temp = mkdtempSync(join(tmpdir(), "robo-video-"));
    const input = join(temp, "produto.jpg");
    const output = join(temp, "oferta.mp4");
    const titleFile = join(temp, "titulo.txt");
    const priceFile = join(temp, "preco.txt");
    const discountFile = join(temp, "desconto.txt");
    const ctaFile = join(temp, "cta.txt");

    try {
      await rest("video_jobs?id=eq." + encodeURIComponent(job.id), {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ status: "processando", attempts: Number(job.attempts || 0) + 1, error: null, updated_at: new Date().toISOString() })
      });

      const dados = job.dados || {};
      const imageUrl = dados.imagem_url;
      if (!imageUrl) throw new Error("A oferta não possui imagem para gerar o vídeo.");

      await download(imageUrl, input);

      const title = String(dados.titulo || "Oferta especial").slice(0, 90);
      const price = Number(dados.preco || 0);
      const discount = Number(dados.desconto || 0);

      writeFileSync(titleFile, title);
      writeFileSync(priceFile, "R$ " + price.toFixed(2).replace(".", ","));
      writeFileSync(discountFile, discount > 0 ? discount + "% OFF" : "OFERTA ESPECIAL");
      writeFileSync(ctaFile, "CLIQUE NO LINK E APROVEITE");

      // Vídeo vertical mais dinâmico: movimento de câmera + blocos de informação
      // que entram em momentos diferentes, sem alterar o restante do fluxo.
      const vf = [
        "scale=1080:1920:force_original_aspect_ratio=decrease",
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black",
        "zoompan=z='min(zoom+0.0012,1.12)':d=300:s=1080x1920:fps=30",
        "fade=t=in:st=0:d=0.35",
        "fade=t=out:st=9.35:d=0.65",
        "drawbox=x=35:y=35:w=1010:h=180:color=black@0.58:t=fill:enable='between(t\\,0\\,2.2)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='ACHADO DO DIA':fontcolor=white:fontsize=62:x=(w-text_w)/2:y=88:alpha='if(lt(t,0.35),t/0.35,1)':enable='between(t\\,0\\,2.2)'",
        "drawbox=x=45:y=h-570:w=990:h=250:color=black@0.64:t=fill:enable='between(t\\,3\\,7.8)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=" + titleFile + ":fontcolor=white:fontsize=38:line_spacing=8:x=(w-text_w)/2:y=h-535:box=0:alpha='if(lt(t,3.35),(t-3)/0.35,1)':enable='between(t\\,3\\,7.8)'",
        "drawbox=x=70:y=1220:w=940:h=250:color=black@0.78:t=fill:enable='between(t\\,5.2\\,8.6)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=" + priceFile + ":fontcolor=white:fontsize=72:x=(w-text_w)/2:y=1265:alpha='if(lt(t,5.5),(t-5.2)/0.3,1)':enable='between(t\\,5.2\\,8.6)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=" + discountFile + ":fontcolor=white:fontsize=58:x=(w-text_w)/2:y=1360:alpha='if(lt(t,5.6),(t-5.2)/0.4,1)':enable='between(t\\,5.2\\,8.6)'",
        "drawbox=x=55:y=1600:w=970:h=190:color=black@0.72:t=fill:enable='between(t\\,7.8\\,10)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=" + ctaFile + ":fontcolor=white:fontsize=42:x=(w-text_w)/2:y=1665:alpha='if(lt(t,8.1),(t-7.8)/0.3,1)':enable='between(t\\,7.8\\,10)'"
      ].join(",");

      execFileSync("ffmpeg", [
        "-y", "-loop", "1", "-i", input, "-t", "10",
        "-vf", vf, "-r", "30",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", output
      ], { stdio: "inherit" });

      const path = job.user_id + "/" + safeName(dados.titulo) + "-" + job.content_id + ".mp4";
      const outputUrl = await upload(path, output);

      await rest("video_jobs?id=eq." + encodeURIComponent(job.id), {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ status: "concluido", output_path: path, output_url: outputUrl, updated_at: new Date().toISOString(), error: null })
      });

      await rest("contents?id=eq." + encodeURIComponent(job.content_id), {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ video_url: outputUrl, video_source: "gerado", video_status: "pronto", video_storage_path: path, updated_at: new Date().toISOString() })
      });

      console.log("Vídeo concluído:", job.id, outputUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Falha no vídeo", job.id, message);

      await rest("video_jobs?id=eq." + encodeURIComponent(job.id), {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ status: Number(job.attempts || 0) + 1 >= 3 ? "erro" : "pendente", error: message.slice(0, 1000), updated_at: new Date().toISOString() })
      }).catch(() => {});
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
}

await main();
