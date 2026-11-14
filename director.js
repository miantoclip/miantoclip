
// MIANTOCLIP - Director Inteligente v1
// Planificador de escenas para videos largos.

export function crearDirector({
  idea = "",
  tipo = "historia",
  duracion = 60,
  imagen = false
} = {}) {
  const texto = String(idea).trim();

  if (!texto) {
    throw new Error("Escribe una idea para el video.");
  }

  const tipos = [
    "historia",
    "documental",
    "musical",
    "entrevista",
    "publicidad",
    "libre"
  ];

  const categoria = tipos.includes(tipo) ? tipo : "libre";
  const segundos = Math.max(5, Math.min(300, Number(duracion) || 60));

  const escenas = [];
  let restante = segundos;
  let numero = 1;

  while (restante > 0) {
    const tiempo = Math.min(10, restante);

    escenas.push({
      numero,
      duracion: tiempo,
      descripcion: texto,
      tipo: categoria,
      usarImagenReferencia: Boolean(imagen),
      continuidad: numero === 1
        ? "Presentar la escena"
        : "Mantener personajes, aspecto y ambiente",
      audio: {
        voz: categoria === "documental" || categoria === "entrevista",
        musica: categoria === "musical",
        ambiente: true
      },
      estado: "pendiente"
    });

    restante -= tiempo;
    numero++;
  }

  return {
    motor: "MIANTOCLIP DIRECTOR",
    version: "1.0",
    idea: texto,
    tipo: categoria,
    duracion: segundos,
    escenas,
    totalEscenas: escenas.length,
    estado: "planificado"
  };
}
