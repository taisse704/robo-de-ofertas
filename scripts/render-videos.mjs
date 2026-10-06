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

      // Otimizado: 8s/24fps e sem zoompan pesado. Mantém o formato vertical,
      // textos e animações essenciais, reduzindo bastante o custo de CPU.
      const vf = [
        "scale=1080:1920:force_original_aspect_ratio=decrease",
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black",
        "fade=t=in:st=0:d=0.3",
        "fade=t=out:st=7.35:d=0.65",
        "drawbox=x=35:y=35:w=1010:h=180:color=black@0.58:t=fill:enable='between(t\\,0\\,1.8)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='ACHADO DO DIA':fontcolor=white:fontsize=62:x=(w-text_w)/2:y=88:alpha='if(lt(t,0.3),t/0.3,1)':enable='between(t\\,0\\,1.8)'",
        "drawbox=x=45:y=h-570:w=990:h=250:color=black@0.64:t=fill:enable='between(t\\,2.0\\,6.2)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=" + titleFile + ":fontcolor=white:fontsize=38:line_spacing=8:x=(w-text_w)/2:y=h-535:alpha='if(lt(t,2.35),(t-2)/0.35,1)':enable='between(t\\,2.0\\,6.2)'",
        "drawbox=x=70:y=1220:w=940:h=250:color=black@0.78:t=fill:enable='between(t\\,4.2\\,7.0)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=" + priceFile + ":fontcolor=white:fontsize=72:x=(w-text_w)/2:y=1265:alpha='if(lt(t,4.5),(t-4.2)/0.3,1)':enable='between(t\\,4.2\\,7.0)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=" + discountFile + ":fontcolor=white:fontsize=58:x=(w-text_w)/2:y=1360:alpha='if(lt(t,4.6),(t-4.2)/0.4,1)':enable='between(t\\,4.2\\,7.0)'",
        "drawbox=x=55:y=1600:w=970:h=190:color=black@0.72:t=fill:enable='between(t\\,6.4\\,8)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=" + ctaFile + ":fontcolor=white:fontsize=42:x=(w-text_w)/2:y=1665:alpha='if(lt(t,6.7),(t-6.4)/0.3,1)':enable='between(t\\,6.4\\,8)'"
      ].join(",");

      execFileSync("ffmpeg", [
        "-y", "-loop", "1", "-i", input, "-t", "8",
        "-vf", vf, "-r", "24",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "21",
        "-threads", "0",
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
