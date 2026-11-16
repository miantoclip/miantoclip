
// MIAntoClip - Cloudflare Worker independiente

const API = "https://api.dev.runwayml.com/v1";
const VERSION = "2024-11-06";
const MAX_SECONDS = 900;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function message(data, fallback) {
  const value =
    data?.error || data?.message || data?.failure || fallback;

  return typeof value === "string"
    ? value
    : JSON.stringify(value);
}

function validHttps(value) {
  return (
    typeof value === "string" &&
    /^https:\/\/[^\s]+$/i.test(value) &&
    value.length <= 2048
  );
}

function validImage(value) {
  return (
    typeof value === "string" &&
    value.length <= 5700000 &&
    (
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ||
      validHttps(value)
    )
  );
}

function durationValid(value, min = 30, max = MAX_SECONDS) {
  return (
    Number.isInteger(value) &&
    value >= min &&
    value <= max &&
    value % 5 === 0
  );
}

function segmentsFor(seconds) {
  const segments = [];

  for (let remaining = seconds; remaining > 0;) {
    const duration = remaining >= 10 ? 10 : 5;

    segments.push({
      number: segments.length + 1,
      duration
    });

    remaining -= duration;
  }

  return segments;
}

async function runway(env, endpoint, payload, method = "POST") {
  const response = await fetch(API + endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${env.RUNWAYML_API_SECRET}`,
      "X-Runway-Version": VERSION,
      ...(method === "POST"
        ? { "Content-Type": "application/json" }
        : {})
    },
    ...(method === "POST"
      ? { body: JSON.stringify(payload) }
      : {})
  });

  const data = await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

function taskResponse(result, kind, notice) {
  if (!result.ok) {
    return json({
      error: message(
        result.data,
        "El proveedor rechazó la solicitud"
      ),
      details: result.data?.issues || null
    }, result.status);
  }

  return json({
    id: result.data?.id,
    kind,
    notice
  });
}

function director(body) {
  const idea = String(body.idea || "").trim();
  const duration = Number(body.duracion ?? 60);

  if (
    !idea ||
    idea.length > 2000 ||
    !durationValid(duration)
  ) {
    return json({
      error: "Indica una idea y duración de 30 a 900 segundos, múltiplo de 5"
    }, 400);
  }

  const segments = segmentsFor(duration);

  return json({
    idea,
    tipo: String(body.tipo || "historia"),
    duracion: duration,
    imagen: Boolean(body.imagen),
    escenas: segments.map(s => ({
      ...s,
      instruccion: `Continuar la historia: ${idea}`,
      estado: "pendiente"
    })),
    notice: "Guion técnico orientativo; no genera ni monta el vídeo."
  });
}

function documental(body) {
  const tema = String(
    body.tema || "Las pirámides de Egipto"
  ).trim();

  const duration = Number(body.duracion ?? 420);

  if (
    !tema ||
    tema.length > 2000 ||
    !durationValid(duration)
  ) {
    return json({
      error: "Tema o duración no válidos (30–900 segundos, múltiplo de 5)"
    }, 400);
  }

  return json({
    tema,
    idioma: String(body.idioma || "es"),
    duracion: duration,
    segmentos: segmentsFor(duration),
    estructura: [
      "Introducción",
      "Contexto",
      "Desarrollo",
      "Conclusión"
    ],
    notice: "Esquema inicial; requiere investigación, narración y montaje."
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS
      });
    }

    const path =
      new URL(request.url).pathname.replace(/\/$/, "") || "/";

    if (path === "/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "MIAntoClip",
        version: "worker-independiente-v2",
        runwayConfigured: Boolean(env.RUNWAYML_API_SECRET),
        minDuration: 30,
        maxDuration: MAX_SECONDS
      });
    }

    if (request.method !== "POST") {
      return json({
        error: "Ruta no encontrada"
      }, 404);
    }

    let body;

    try {
      body = await request.json();

      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body)
      ) {
        throw Error();
      }
    } catch {
      return json({
        error: "Envía un objeto JSON válido"
      }, 400);
    }

    if (path === "/director") {
      return director(body);
    }

    if (path === "/documentales") {
      return documental(body);
    }

    if (path === "/plan") {
      const duration = Number(body.duration);

      if (!durationValid(duration)) {
        return json({
          error: "Elige entre 30 y 900 segundos, en múltiplos de 5"
        }, 400);
      }

      const segments = segmentsFor(duration);

      return json({
        duration,
        segments,
        totalSegments: segments.length,
        notice: "Plan de producción. La continuidad, generación por lotes y montaje final aún no están automatizados."
      });
    }

    const routes = [
      "/generate",
      "/segment",
      "/voice",
      "/video-sound",
      "/music",
      "/status"
    ];

    if (!routes.includes(path)) {
      return json({
        error: "Ruta no encontrada"
      }, 404);
    }

    if (!env.RUNWAYML_API_SECRET) {
      return json({
        error: "Falta configurar RUNWAYML_API_SECRET"
      }, 503);
    }

    try {
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
            error: "Imagen base64 o URL HTTPS no válida, o demasiado grande"
          }, 400);
        }

        const result = await runway(
          env,
          "/image_to_video",
          {
            model: "gen4_turbo",
            promptText: prompt,
            promptImage: body.image,
            duration,
            ratio
          }
        );

        if (!result.ok) {
          return taskResponse(
            result,
            "video-segment"
          );
        }

        return json({
          id: result.data?.id,
          kind: "video-segment",
          segmentDuration: duration,
          notice: "Tarea enviada. Consulta /status; todavía no es un vídeo final montado."
        });
      }

      if (path === "/voice") {
        const spoken = String(body.text || "").trim();

        if (!spoken || spoken.length > 2048) {
          return json({
            error: "Texto de voz: entre 1 y 2048 caracteres"
          }, 400);
        }

        return taskResponse(
          await runway(
            env,
            "/text_to_speech",
            {
              model: "eleven_v3",
              promptText: spoken
            }
          ),
          "voice",
          "Audio independiente; falta mezclarlo con el vídeo."
        );
      }

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

        const payload = {
          model: "mirelo_sfx_2_0",
          videoUri: body.videoUri,
          duration,
          preserveSpeech: Boolean(body.preserveSpeech)
        };

        if (body.prompt) {
          payload.promptText =
            String(body.prompt).slice(0, 2000);
        }

        return taskResponse(
          await runway(
            env,
            "/video_to_audio",
            payload
          ),
          "sound",
          "El audio debe incorporarse durante el montaje."
        );
      }

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

        return taskResponse(
          await runway(
            env,
            "/text_to_music",
            {
              model: "eleven_music_v2_5",
              promptText: prompt,
              duration,
              instrumental: body.instrumental !== false
            }
          ),
          "music",
          "Pista independiente; falta mezclarla con el vídeo."
        );
      }

      const id = String(body.id || "");

      if (!/^[a-f0-9-]{36}$/i.test(id)) {
        return json({
          error: "Identificador no válido"
        }, 400);
      }

      const result = await runway(
        env,
        "/tasks/" + encodeURIComponent(id),
        undefined,
        "GET"
      );

      if (!result.ok) {
        return json({
          error: message(
            result.data,
            "Error consultando Runway"
          )
        }, result.status);
      }

      return json({
        status: result.data.status,
        output: result.data.output || [],
        failure:
          result.data.failure ||
          result.data.failureCode ||
          null
      });

    } catch (e) {
      return json({
        error: String(e?.message || e)
      }, 502);
    }
  }
};
