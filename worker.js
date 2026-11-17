
const RUNWAY_API = "https://api.dev.runwayml.com/v1";
const NURETA_API = "https://developer.nureta.ai";
const RUNWAY_VERSION = "2024-11-06";
const MAX_SECONDS = 900;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
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

function errorMessage(data, fallback) {
  const value = data?.error || data?.message || fallback;
  return typeof value === "string"
    ? value
    : JSON.stringify(value);
}

function validHttps(value) {
  return typeof value === "string" &&
    /^https:\/\/[^\s]+$/i.test(value) &&
    value.length <= 2048;
}

function validImage(value) {
  return typeof value === "string" &&
    value.length <= 5700000 &&
    (
      validHttps(value) ||
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
    );
}

function validDuration(value) {
  return Number.isInteger(value) &&
    value >= 30 &&
    value <= MAX_SECONDS &&
    value % 5 === 0;
}

function scenesFor(duration) {
  const scenes = [];
  let remaining = duration;

  while (remaining > 0) {
    const seconds = remaining >= 10 ? 10 : 5;
    scenes.push({
      scene: scenes.length + 1,
      seconds,
      status: "pending"
    });
    remaining -= seconds;
  }

  return scenes;
}

function authorized(request, env) {
  return Boolean(env.MIANTOCLIP_ADMIN_TOKEN) &&
    request.headers.get("Authorization") ===
      `Bearer ${env.MIANTOCLIP_ADMIN_TOKEN}`;
}

async function callApi(base, path, key, body, runway = false) {
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };

  if (runway) {
    headers["X-Runway-Version"] = RUNWAY_VERSION;
  }

  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) })
  });

  const raw = await response.text();
  let data;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { message: raw.slice(0, 400) };
  }

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

function upstreamError(result, fallback) {
  return json({
    error: errorMessage(result.data, fallback),
    details: result.data
  }, result.status);
}

async function readBody(request) {
  try {
    const body = await request.json();

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return null;
    }

    return body;
  } catch {
    return null;
  }
}

function planVideo(body) {
  const duration = Number(
    body.duration ?? body.duracion ?? 60
  );

  const prompt = String(
    body.prompt || body.idea || body.tema || ""
  ).trim();

  if (!validDuration(duration)) {
    return json({
      error: "Duracion entre 30 y 900 segundos, multiplo de 5"
    }, 400);
  }

  if (!prompt || prompt.length > 2000) {
    return json({
      error: "Falta una descripcion valida"
    }, 400);
  }

  return json({
    ok: true,
    prompt,
    duration,
    scenes: scenesFor(duration),
    audio: "pending",
    videoAssembly: "pending",
    notice: "Plan tecnico. No genera ni monta el video."
  });
}

async function handleRunway(path, body, env) {
  if (!env.RUNWAYML_API_SECRET) {
    return json({
      error: "Falta RUNWAYML_API_SECRET"
    }, 503);
  }

  const call = (endpoint, payload) =>
    callApi(
      RUNWAY_API,
      endpoint,
      env.RUNWAYML_API_SECRET,
      payload,
      true
    );

  if (path === "/generate" || path === "/segment") {
    const prompt = String(
      body.prompt || body.promptText || ""
    ).trim();

    const image = body.image || body.promptImage;

    const duration = Number(
      body.segmentDuration ?? body.duration ?? 10
    );

    const ratio = body.ratio || "1280:720";

    if (!prompt || prompt.length > 1000) {
      return json({
        error: "Descripcion no valida"
      }, 400);
    }

    if (!validImage(image)) {
      return json({
        error: "Imagen HTTPS o base64 no valida"
      }, 400);
    }

    if (![5, 10].includes(duration)) {
      return json({
        error: "Runway admite segmentos de 5 o 10 segundos"
      }, 400);
    }

    if (!["1280:720", "720:1280"].includes(ratio)) {
      return json({
        error: "Formato no valido"
      }, 400);
    }

    const result = await call("/image_to_video", {
      model: "gen4_turbo",
      promptText: prompt,
      promptImage: image,
      duration,
      ratio
    });

    if (!result.ok) {
      return upstreamError(result, "Error generando video");
    }

    return json({
      id: result.data.id,
      status: result.data.status || "PENDING",
      engine: "runway",
      kind: "video-segment",
      segmentDuration: duration
    });
  }

  if (path === "/voice") {
    const spoken = String(body.text || "").trim();

    if (!spoken || spoken.length > 2048) {
      return json({
        error: "Texto de voz no valido"
      }, 400);
    }

    const result = await call("/text_to_speech", {
      model: "eleven_v3",
      promptText: spoken
    });

    if (!result.ok) {
      return upstreamError(result, "Error generando voz");
    }

    return json({
      id: result.data.id,
      kind: "voice",
      notice: "Audio independiente, pendiente de montaje."
    });
  }

  if (path === "/music") {
    const prompt = String(body.prompt || "").trim();
    const duration = Number(body.duration);

    if (!prompt || prompt.length > 4100) {
      return json({
        error: "Descripcion musical no valida"
      }, 400);
    }

    if (
      !Number.isInteger(duration) ||
      duration < 3 ||
      duration > 600
    ) {
      return json({
        error: "Duracion musical entre 3 y 600 segundos"
      }, 400);
    }

    const result = await call("/text_to_music", {
      model: "eleven_music_v2_5",
      promptText: prompt,
      duration,
      instrumental: body.instrumental !== false
    });

    if (!result.ok) {
      return upstreamError(result, "Error generando musica");
    }

    return json({
      id: result.data.id,
      kind: "music",
      notice: "Pista independiente, pendiente de montaje."
    });
  }

  if (path === "/video-sound") {
    if (!validHttps(body.videoUri)) {
      return json({
        error: "URL HTTPS del video no valida"
      }, 400);
    }

    const duration = Number(body.duration);

    if (
      !Number.isFinite(duration) ||
      duration < 1 ||
      duration > 600
    ) {
      return json({
        error: "Duracion de sonido entre 1 y 600 segundos"
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

    const result = await call("/video_to_audio", payload);

    if (!result.ok) {
      return upstreamError(result, "Error generando sonido");
    }

    return json({
      id: result.data.id,
      kind: "sound",
      notice: "Audio independiente, pendiente de montaje."
    });
  }

  if (path === "/status") {
    const id = String(body.id || "");

    if (!/^[a-f0-9-]{36}$/i.test(id)) {
      return json({ error: "ID no valido" }, 400);
    }

    const result = await call(
      "/tasks/" + encodeURIComponent(id)
    );

    if (!result.ok) {
      return upstreamError(result, "Error consultando Runway");
    }

    return json({
      status: result.data.status,
      output: result.data.output || [],
      failure:
        result.data.failure ||
        result.data.failureCode ||
        null
    });
  }

  return json({ error: "Ruta Runway no encontrada" }, 404);
}

async function handleNureta(path, body, env) {
  const call = (endpoint, payload) =>
    callApi(
      NURETA_API,
      endpoint,
      env.NURETA_API_KEY,
      payload
    );

  const base = "/api/v3/contents/generations/tasks";

  if (path === "/nureta/check") {
    const result = await call(
      base + "?limit=20&offset=0"
    );

    return json({
      ok: result.ok,
      engine: "nureta",
      upstreamStatus: result.status,
      authenticationAccepted: result.ok,
      message: result.ok
        ? "Nureta responde correctamente"
        : "Nureta devolvio un error",
      ...(result.ok ? {} : { details: result.data })
    }, result.ok ? 200 : result.status);
  }

  if (path === "/nureta/status") {
    const id = String(body.id || "");

    if (!/^cgt-[a-zA-Z0-9_-]+$/.test(id)) {
      return json({
        error: "ID Nureta no valido"
      }, 400);
    }

    const result = await call(
      base + "/" + encodeURIComponent(id)
    );

    if (!result.ok) {
      return upstreamError(
        result,
        "Error consultando Nureta"
      );
    }

    return json({
      id: result.data.id,
      status: result.data.status,
      video_url:
        result.data.content?.video_url ||
        result.data.video_url ||
        null,
      media: result.data.media || [],
      segments: result.data.segments || [],
      step: result.data.step || null,
      usage: result.data.usage || null,
      error: result.data.error || null
    });
  }

  if (path === "/nureta/generate") {
    if (body.confirmed_adult !== true) {
      return json({
        error: "Se requiere confirmacion de mayoria de edad"
      }, 403);
    }

    const prompt = String(body.prompt || "").trim();
    const duration = Number(body.duration ?? 5);
    const model = body.model || "seahorse-480p";
    const ratio = body.ratio || "9:16";

    if (!prompt || prompt.length > 1000) {
      return json({
        error: "Descripcion no valida"
      }, 400);
    }

    const models = [
      "seahorse-480p",
      "seahorse-720p",
      "seahorse-1080p"
    ];

    if (!models.includes(model)) {
      return json({
        error: "Modelo Nureta no valido"
      }, 400);
    }

    const ratios = [
      "16:9", "9:16", "4:3",
      "3:4", "1:1", "21:9", "adaptive"
    ];

    if (!ratios.includes(ratio)) {
      return json({
        error: "Formato Nureta no valido"
      }, 400);
    }

    const allowedDuration =
      Number.isInteger(duration) &&
      (
        [5, 8, 10, 12, 15].includes(duration) ||
        (duration >= 16 && duration <= 180)
      );

    if (!allowedDuration) {
      return json({
        error: "Duracion Nureta no valida"
      }, 400);
    }

    const firstImage = String(
      body.image_url ||
      body.first_frame_url ||
      ""
    );

    const lastImage = String(
      body.last_frame_url || ""
    );

    for (const url of [firstImage, lastImage]) {
      if (url && !validHttps(url)) {
        return json({
          error: "Las imagenes deben usar URL HTTPS"
        }, 400);
      }
    }

    const content = [
      {
        type: "text",
        text: prompt
      },
      ...(firstImage ? [{
        type: "image_url",
        image_url: { url: firstImage },
        role: "first_frame"
      }] : []),
      ...(lastImage ? [{
        type: "image_url",
        image_url: { url: lastImage },
        role: "last_frame"
      }] : [])
    ];

    const payload = {
      model,
      content,
      ratio,
      duration,
      generate_audio: body.generate_audio !== false,
      ...(duration > 15 ? { auto_chain: true } : {})
    };

    const result = await call(base, payload);

    if (!result.ok) {
      return upstreamError(
        result,
        "Nureta rechazo la solicitud"
      );
    }

    return json({
      id: result.data.id,
      status: result.data.status,
      engine: "nureta",
      usage: result.data.usage || null
    });
  }

  return json({
    error: "Ruta Nureta no encontrada"
  }, 404);
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
        service: "MIAntoClip API",
        version: "unified-v3",
        runwayConfigured: Boolean(env.RUNWAYML_API_SECRET),
        nuretaConfigured: Boolean(env.NURETA_API_KEY),
        adultAccessConfigured:
          Boolean(env.MIANTOCLIP_ADMIN_TOKEN),
        minDuration: 30,
        maxDuration: MAX_SECONDS,
        audio: "pending",
        videoAssembly: "pending"
      });
    }

    if (request.method !== "POST") {
      return json({
        error: "Ruta no encontrada"
      }, 404);
    }

    const nuretaRoutes = [
      "/nureta/check",
      "/nureta/generate",
      "/nureta/status"
    ];

    if (nuretaRoutes.includes(path)) {
      if (!env.NURETA_API_KEY) {
        return json({
          error: "Falta NURETA_API_KEY"
        }, 503);
      }

      if (!authorized(request, env)) {
        return json({
          error: "Acceso no autorizado"
        }, 401);
      }
    }

    if (path === "/nureta/check") {
      try {
        return await handleNureta(path, {}, env);
      } catch (e) {
        return json({
          error: "Error de conexion con Nureta"
        }, 502);
      }
    }

    const body = await readBody(request);

    if (!body) {
      return json({
        error: "Envia un objeto JSON valido"
      }, 400);
    }

    if (
      path === "/plan" ||
      path === "/director" ||
      path === "/documentales"
    ) {
      return planVideo(body);
    }

    const runwayRoutes = [
      "/generate",
      "/segment",
      "/voice",
      "/music",
      "/video-sound",
      "/status"
    ];

    try {
      if (runwayRoutes.includes(path)) {
        return await handleRunway(path, body, env);
      }

      if (nuretaRoutes.includes(path)) {
        return await handleNureta(path, body, env);
      }

      return json({
        error: "Ruta no encontrada"
      }, 404);

    } catch (e) {
      return json({
        error: "Error comunicando con el proveedor"
      }, 502);
    }
  }
};
