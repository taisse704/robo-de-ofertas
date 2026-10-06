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
        body: JSON.stringify({
          status: "processando",
          attempts: Number(job.attempts || 0) + 1,
          error: null,
          updated_at: new Date().toISOString()
        })
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
      writeFileSync(ctaFile, "👇 CONFIRA A OFERTA");

      // Novo modelo: Short vertical de 9s, com movimento de câmera,
      // cortes de informação, CTA pulsante e trilha instrumental original
      // sintetizada pelo próprio FFmpeg (sem usar música comercial).
      const vf = [
        "scale=1166:2074:force_original_aspect_ratio=increase",
        "crop=1080:1920:x='43+28*sin(2*PI*t/9)':y='77+18*cos(2*PI*t/9)'",
        "eq=contrast=1.04:saturation=1.08:brightness=0.02",
        "fade=t=in:st=0:d=0.18",
        "fade=t=out:st=8.35:d=0.65",

        // Gancho
        "drawbox=x=28:y=34:w=1024:h=176:color=black@0.58:t=fill:enable='between(t\\,0\\,1.55)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='VOCÊ PAGARIA QUANTO?':fontcolor=white:fontsize=55:x='(w-text_w)/2+220*(1-min(max(t/0.35\\,0)\\,1))':y=86:alpha='if(lt(t,0.25),t/0.25,1)':enable='between(t\\,0\\,1.55)'",

        // Produto + chamada
        "drawbox=x=42:y=1030:w=996:h=280:color=black@0.58:t=fill:enable='between(t\\,1.15\\,4.15)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='ACHADO DO DIA 🔥':fontcolor=white:fontsize=44:x='(w-text_w)/2':y=1065:alpha='if(lt(t,1.45),(t-1.15)/0.3,1)':enable='between(t\\,1.15\\,4.15)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=" + titleFile + ":fontcolor=white:fontsize=34:line_spacing=6:x='(w-text_w)/2':y=1135:alpha='if(lt(t,1.7),(t-1.4)/0.3,1)':enable='between(t\\,1.45\\,4.15)'",

        // Preço entra como impacto
        "drawbox=x=58:y=1320:w=964:h=300:color=black@0.78:t=fill:enable='between(t\\,3.55\\,7.1)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=" + priceFile + ":fontcolor=white:fontsize=78:x='(w-text_w)/2':y=1365:alpha='if(lt(t,3.9),(t-3.55)/0.35,1)':enable='between(t\\,3.55\\,7.1)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=" + discountFile + ":fontcolor=white:fontsize=58:x='(w-text_w)/2':y=1465:alpha='if(lt(t,4.05),(t-3.65)/0.4,1)':enable='between(t\\,3.55\\,7.1)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='🔥 CORRE QUE PODE ACABAR':fontcolor=white:fontsize=34:x='(w-text_w)/2':y=1555:alpha='0.95+0.05*sin(12*t)':enable='between(t\\,4.4\\,7.1)'",

        // CTA final pulsando
        "drawbox=x=55:y=1645:w=970:h=205:color=black@0.72:t=fill:enable='between(t\\,6.8\\,9)'",
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=" + ctaFile + ":fontcolor=white:fontsize=48:x='(w-text_w)/2':y=1715:alpha='0.78+0.22*(0.5+0.5*sin(9*t))':enable='between(t\\,6.8\\,9)'"
      ].join(",");

      // Trilha instrumental curta e original, sintetizada localmente.
      // Não depende de arquivo externo nem de música protegida.
      const audioInputs = [
        "sine=frequency=196:duration=9",
        "sine=frequency=246.94:duration=9",
        "sine=frequency=293.66:duration=9",
        "sine=frequency=82:duration=9",
        "sine=frequency=1400:duration=9"
      ];

      execFileSync("ffmpeg", [
        "-y",
        "-loop", "1", "-i", input,
        "-f", "lavfi", "-i", audioInputs[0],
        "-f", "lavfi", "-i", audioInputs[1],
        "-f", "lavfi", "-i", audioInputs[2],
        "-f", "lavfi", "-i", audioInputs[3],
        "-f", "lavfi", "-i", audioInputs[4],
        "-t", "9",
        "-filter_complex",
        [
          "[1:a]volume=0.045[p1]",
          "[2:a]volume=0.035[p2]",
          "[3:a]volume=0.025[p3]",
          "[4:a]volume='if(lt(mod(t\\,1)\\,0.12)\\,0.22\\,0)'[kick]",
          "[5:a]volume='if(lt(mod(t\\,0.5)\\,0.045)\\,0.06\\,0)'[hat]",
          "[p1][p2][p3][kick][hat]amix=inputs=5:duration=longest:normalize=0,afade=t=in:st=0:d=0.15,afade=t=out:st=8.25:d=0.75[aout]",
          "[0:v]" + vf + "[vout]"
        ].join(";"),
        "-map", "[vout]",
        "-map", "[aout]",
        "-r", "24",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "21",
        "-threads", "0",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-ac", "2",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output
      ], { stdio: "inherit" });

      const path = job.user_id + "/" + safeName(dados.titulo) + "-" + job.content_id + ".mp4";
      const outputUrl = await upload(path, output);

      await rest("video_jobs?id=eq." + encodeURIComponent(job.id), {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "concluido",
          output_path: path,
          output_url: outputUrl,
          updated_at: new Date().toISOString(),
          error: null
        })
      });

      await rest("contents?id=eq." + encodeURIComponent(job.content_id), {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          video_url: outputUrl,
          video_source: "gerado",
          video_status: "pronto",
          video_storage_path: path,
          updated_at: new Date().toISOString()
        })
      });

      console.log("Vídeo concluído:", job.id, outputUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Falha no vídeo", job.id, message);

      await rest("video_jobs?id=eq." + encodeURIComponent(job.id), {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          status: Number(job.attempts || 0) + 1 >= 3 ? "erro" : "pendente",
          error: message.slice(0, 1000),
          updated_at: new Date().toISOString()
        })
      }).catch(() => {});
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
}

await main();
