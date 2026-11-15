
import { crearDirector } from "./director.js";
import { crearPlanDocumental } from "./documentales.js";

const API = "https://api.dev.runwayml.com/v1";
const VERSION = "2024-11-06";
const MAX_SECONDS = 900;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...cors
    }
  });
}

function errorMessage(data, fallback) {
  return data?.error || data?.message || fallback;
}

function validImage(image) {
  return typeof image === "string" &&
    image.length <= 5700000 &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image);
}

function validHttps(url) {
  return typeof url === "string" &&
    /^https:\/\//i.test(url) &&
    url.length <= 2048;
}

function segmentsFor(seconds) {
  const segments = [];
  let remaining = seconds;

  while (remaining > 0) {
    const duration = remaining >= 10 ? 10 : 5;

    segments.push({
      number: segments.length + 1,
      duration
    });

    remaining -= duration;
  }

  return segments;
}

async function runway(env, endpoint, body) {
  const response = await fetch(API + endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RUNWAYML_API_SECRET}`,
      "X-Runway-Version": VERSION,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    const path = new URL(request.url).pathname;

    // Estado del servidor
    if (path === "/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "MIAntoClip",
        version: "30s-15min-audio-v1",
        runwayConfigured: Boolean(env.RUNWAYML_API_SECRET),
        minDuration: 30,
        maxDuration: MAX_SECONDS
      });
    }

    if (request.method !== "POST") {
      return json({ error: "Ruta no encontrada" }, 404);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Envía un JSON válido" }, 400);
    }

    // Director inteligente
    if (path === "/director") {
      try {
        return json(crearDirector({
          idea: body.idea,
          tipo: body.tipo || "historia",
          duracion: body.duracion || 60,
          imagen: Boolean(body.imagen)
        }));
      } catch (e) {
        return json({ error: String(e.message) }, 400);
      }
    }

    // Planificación de documentales
    if (path === "/documentales") {
      try {
        return json(crearPlanDocumental({
          tema: body.tema || "Las pirámides de Egipto",
          duracion: body.duracion ?? 420,
          idioma: body.idioma || "es"
        }));
      } catch (e) {
        return json({ error: String(e.message) }, 400);
      }
    }

    // Planificación de vídeos de 30 a 900 segundos
    if (path === "/plan") {
      const duration = Number(body.duration);

      if (
        !Number.isInteger(duration) ||
        duration < 30 ||
        duration > MAX_SECONDS ||
        duration % 5 !== 0
      ) {
        return json({
          error: "Elige entre 30 y 900 segundos, en múltiplos de 5"
        }, 400);
      }

      const segments = segmentsFor(duration);

      return json({
        duration,
        segments,
        totalSegments: segments.length,
        notice: "Plan de producción. Los fragmentos se generan por separado; aún hace falta automatizar continuidad y montaje final."
      });
    }

    if (!env.RUNWAYML_API_SECRET) {
      return json({
        error: "Falta configurar RUNWAYML_API_SECRET"
      }, 503);
    }

    // Generación de fragmentos internos de vídeo
    if (path === "/generate" || path === "/segment") {
      const prompt = String(body.prompt || "").trim();
      const duration = Number(
        body.segmentDuration ?? body.duration ?? 10
      );
      const ratio = body.ratio || "1280:720";

      if (!prompt || prompt.length > 1000) {
        return json({
          error: "Descripción no válida (1–1000 caracteres)"
        }, 400);
      }

      if (![5, 10].includes(duration)) {
        return json({
          error: "Los fragmentos técnicos deben durar 5 o 10 segundos"
        }, 400);
      }

      if (!["1280:720", "720:1280"].includes(ratio)) {
        return json({
          error: "Formato no válido"
        }, 400);
      }

      if (!validImage(body.image)) {
        return json({
          error: "Imagen base64 no válida o demasiado grande"
        }, 400);
      }

      try {
        const result = await runway(env, "/image_to_video", {
          model: "gen4_turbo",
          promptText: prompt,
          promptImage: body.image,
          duration,
          ratio
        });

        if (!result.ok) {
          return json({
            error: errorMessage(
              result.data,
              "Runway rechazó el vídeo"
            ),
            details: result.data.issues || null
          }, result.status);
        }

        return json({
          id: result.data.id,
          kind: "video-segment",
          segmentDuration: duration,
          notice: "Fragmento generado. Todavía no es un vídeo final montado."
        });
      } catch (e) {
        return json({ error: String(e.message) }, 502);
      }
    }

    // Voz hablada a partir de texto
    if (path === "/voice") {
      const text = String(body.text || "").trim();

      if (!text || text.length > 2048) {
        return json({
          error: "Texto de voz: entre 1 y 2048 caracteres"
        }, 400);
      }

      try {
        const result = await runway(env, "/text_to_speech", {
          model: "eleven_v3",
          promptText: text
        });

        if (!result.ok) {
          return json({
            error: errorMessage(
              result.data,
              "Error generando voz"
            ),
            details: result.data.issues || null
          }, result.status);
        }

        return json({
          id: result.data.id,
          kind: "voice",
          notice: "Audio independiente: falta mezclarlo con el vídeo."
        });
      } catch (e) {
        return json({ error: String(e.message) }, 502);
      }
    }

    // Efectos de sonido para vídeo
    if (path === "/video-sound") {
      if (!validHttps(body.videoUri)) {
        return json({
          error: "Indica una URL HTTPS del vídeo"
        }, 400);
      }

      const duration = Number(body.duration);

      if (
        !Number.isFinite(duration) ||
        duration < 1 ||
        duration > 600
      ) {
        return json({
          error: "Duración de sonido entre 1 y 600 segundos"
        }, 400);
      }

      try {
        const payload = {
          model: "mirelo_sfx_2_0",
          videoUri: body.videoUri,
          duration,
          preserveSpeech: Boolean(body.preserveSpeech)
        };

        if (body.prompt) {
          payload.promptText = String(body.prompt).slice(0, 2000);
        }

        const result = await runway(
          env,
          "/video_to_audio",
          payload
        );

        if (!result.ok) {
          return json({
            error: errorMessage(
              result.data,
              "Error generando efectos"
            ),
            details: result.data.issues || null
          }, result.status);
        }

        return json({
          id: result.data.id,
          kind: "sound",
          notice: "El audio debe incorporarse al vídeo durante el montaje."
        });
      } catch (e) {
        return json({ error: String(e.message) }, 502);
      }
    }

    // Música
    if (path === "/music") {
      const prompt = String(body.prompt || "").trim();
      const duration = Number(body.duration);

      if (!prompt || prompt.length > 4100) {
        return json({
          error: "Describe la música (máximo 4100 caracteres)"
        }, 400);
      }

      if (
        !Number.isInteger(duration) ||
        duration < 3 ||
        duration > 600
      ) {
        return json({
          error: "La música admite entre 3 y 600 segundos por tarea"
        }, 400);
      }

      try {
        const result = await runway(env, "/text_to_music", {
          model: "eleven_music_v2_5",
          promptText: prompt,
          duration,
          instrumental: body.instrumental !== false
        });

        if (!result.ok) {
          return json({
            error: errorMessage(
              result.data,
              "Error generando música"
            ),
            details: result.data.issues || null
          }, result.status);
        }

        return json({
          id: result.data.id,
          kind: "music",
          notice: "Pista independiente: falta mezclarla con el vídeo."
        });
      } catch (e) {
        return json({ error: String(e.message) }, 502);
      }
    }

    // Consultar tareas de Runway
    if (path === "/status") {
      const id = String(body.id || "");

      if (!/^[a-f0-9-]{36}$/i.test(id)) {
        return json({
          error: "Identificador no válido"
        }, 400);
      }

      try {
        const response = await fetch(
          API + "/tasks/" + encodeURIComponent(id),
          {
            headers: {
              Authorization: `Bearer ${env.RUNWAYML_API_SECRET}`,
              "X-Runway-Version": VERSION
            }
          }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          return json({
            error: errorMessage(
              data,
              "Error consultando Runway"
            )
          }, response.status);
        }

        return json({
          status: data.status,
          output: data.output || [],
          failure: data.failure || data.failureCode || null
        });
      } catch (e) {
        return json({ error: String(e.message) }, 502);
      }
    }

    return json({
      error: "Ruta no encontrada"
    }, 404);
  }
};
