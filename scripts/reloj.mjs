/**
 * Genera un reloj de actividad de 24 horas a partir de los commits del usuario.
 *
 * Cada hora es un sector radial cuyo radio es proporcional al número de commits
 * hechos en esa hora (en horario local, no UTC). El resultado es una huella
 * horaria: cuándo programa esta persona realmente.
 *
 * Salida: dist/reloj.svg (claro) y dist/reloj-dark.svg (oscuro)
 */

import { writeFileSync, mkdirSync } from "node:fs";

const USER = process.env.GH_USER ?? "Alexisghub-Z";
const TOKEN = process.env.GITHUB_TOKEN;
const TZ_OFFSET = Number(process.env.TZ_OFFSET ?? -6); // CDMX = UTC-6

const TEMAS = {
  claro: {
    fondo: "none",
    trazo: "#dee2f2",
    texto: "#14141c",
    tenue: "rgba(20,20,36,0.42)",
    barra: "#6366a8",
    pico: "#4a80c4",
    noche: "rgba(99,102,168,0.07)",
  },
  oscuro: {
    fondo: "none",
    trazo: "rgba(255,255,255,0.10)",
    texto: "#e8e8ef",
    tenue: "#8f92a8",
    barra: "#8688c0",
    pico: "#93c5fd",
    noche: "rgba(134,136,192,0.09)",
  },
};

async function traerCommits() {
  const query = `{
    user(login: "${USER}") {
      repositories(first: 20, orderBy: {field: PUSHED_AT, direction: DESC}, ownerAffiliations: OWNER) {
        nodes {
          defaultBranchRef {
            target { ... on Commit { history(first: 100) { nodes { committedDate } } } }
          }
        }
      }
    }
  }`;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join("; "));

  return json.data.user.repositories.nodes
    .flatMap((r) => r.defaultBranchRef?.target?.history?.nodes ?? [])
    .map((c) => c.committedDate);
}

function porHora(fechas) {
  const horas = new Array(24).fill(0);
  for (const f of fechas) {
    const utc = Number(f.slice(11, 13));
    horas[(utc + TZ_OFFSET + 24) % 24]++;
  }
  return horas;
}

function svg(horas, tema) {
  const t = TEMAS[tema];
  const W = 520, H = 300;
  const cx = 150, cy = H / 2;
  const rInterno = 34, rMax = 104;

  const total = horas.reduce((a, b) => a + b, 0);
  const max = Math.max(...horas, 1);
  const pico = horas.indexOf(max);
  const nocturnos = horas.reduce(
    (n, v, h) => (h >= 20 || h < 3 ? n + v : n),
    0
  );
  const pctNoche = total ? Math.round((nocturnos / total) * 100) : 0;

  // Cada hora ocupa 15°. Empezamos en -90° para que las 00:00 queden arriba.
  const sectores = horas
    .map((v, h) => {
      const frac = v / max;
      const r = rInterno + frac * (rMax - rInterno);
      const a0 = ((h * 15 - 90) * Math.PI) / 180;
      const a1 = (((h + 1) * 15 - 90 - 1.6) * Math.PI) / 180;

      const x0 = cx + rInterno * Math.cos(a0);
      const y0 = cy + rInterno * Math.sin(a0);
      const x1 = cx + r * Math.cos(a0);
      const y1 = cy + r * Math.sin(a0);
      const x2 = cx + r * Math.cos(a1);
      const y2 = cy + r * Math.sin(a1);
      const x3 = cx + rInterno * Math.cos(a1);
      const y3 = cy + rInterno * Math.sin(a1);

      const color = h === pico ? t.pico : t.barra;
      const opacidad = 0.35 + frac * 0.65;
      const retardo = (h * 0.045).toFixed(2);

      const d = `M${x0.toFixed(1)},${y0.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} A${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)} L${x3.toFixed(1)},${y3.toFixed(1)} A${rInterno},${rInterno} 0 0 0 ${x0.toFixed(1)},${y0.toFixed(1)} Z`;

      return `    <path d="${d}" fill="${color}" opacity="0">
      <animate attributeName="opacity" from="0" to="${opacidad.toFixed(2)}" dur="0.5s" begin="${retardo}s" fill="freeze"/>
    </path>`;
    })
    .join("\n");

  // Marcas de hora cada 6h
  const marcas = [0, 6, 12, 18]
    .map((h) => {
      const a = ((h * 15 + 7.5 - 90) * Math.PI) / 180;
      const r = rMax + 16;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      return `    <text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" fill="${t.tenue}" font-size="11" font-family="Inter,system-ui,sans-serif" text-anchor="middle">${String(h).padStart(2, "0")}</text>`;
    })
    .join("\n");

  const filas = [
    [`${total}`, "commits analizados"],
    [`${String(pico).padStart(2, "0")}:00`, "hora pico"],
    [`${pctNoche}%`, "entre 20:00 y 03:00"],
  ]
    .map(
      ([valor, etiqueta], i) => `    <text x="310" y="${118 + i * 46}" fill="${t.texto}" font-size="25" font-weight="600" font-family="Inter,system-ui,sans-serif">${valor}</text>
    <text x="310" y="${136 + i * 46}" fill="${t.tenue}" font-size="11.5" font-family="Inter,system-ui,sans-serif">${etiqueta}</text>`
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Reloj de actividad: ${total} commits, hora pico ${pico}:00, ${pctNoche}% entre las 20:00 y las 03:00">
  <g>
    <circle cx="${cx}" cy="${cy}" r="${rMax + 4}" fill="${t.noche}"/>
    <circle cx="${cx}" cy="${cy}" r="${rMax + 4}" fill="none" stroke="${t.trazo}" stroke-width="1"/>
    <circle cx="${cx}" cy="${cy}" r="${rInterno}" fill="none" stroke="${t.trazo}" stroke-width="1"/>
${sectores}
${marcas}
    <text x="310" y="52" fill="${t.tenue}" font-size="10.5" font-weight="500" letter-spacing="1.6" font-family="Inter,system-ui,sans-serif">CUÁNDO PROGRAMO</text>
    <line x1="310" y1="66" x2="496" y2="66" stroke="${t.trazo}" stroke-width="1"/>
${filas}
  </g>
</svg>
`;
}

const fechas = await traerCommits();
if (fechas.length === 0) throw new Error("No se recibió ningún commit de la API");

const horas = porHora(fechas);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/reloj.svg", svg(horas, "claro"));
writeFileSync("dist/reloj-dark.svg", svg(horas, "oscuro"));

console.log(`${fechas.length} commits · pico ${horas.indexOf(Math.max(...horas))}:00`);
