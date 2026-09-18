import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const username = process.env.GITHUB_USER ?? "MrLucasapl";
const githubToken = process.env.GITHUB_TOKEN;
const outDir = path.resolve("dist");

if (!githubToken) {
  throw new Error("GITHUB_TOKEN is required to fetch the contribution calendar");
}

const levelFrom = (contributionLevel) =>
  (contributionLevel === "FOURTH_QUARTILE" && 4) ||
  (contributionLevel === "THIRD_QUARTILE" && 3) ||
  (contributionLevel === "SECOND_QUARTILE" && 2) ||
  (contributionLevel === "FIRST_QUARTILE" && 1) ||
  0;

const graphql = async (query, variables) => {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${githubToken}`,
      "Content-Type": "application/json",
      "User-Agent": "MrLucasapl-snake",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(await res.text().catch(() => res.statusText));
  }

  const payload = await res.json();
  if (payload.errors?.[0]) {
    throw new Error(payload.errors[0].message);
  }

  return payload.data;
};

const getCreatedYear = async () => {
  const data = await graphql(
    `
      query ($login: String!) {
        user(login: $login) {
          createdAt
        }
      }
    `,
    { login: username },
  );

  return new Date(data.user.createdAt).getUTCFullYear();
};

const getYearCells = async (year, yOffset) => {
  const data = await graphql(
    `
      query ($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              weeks {
                contributionDays {
                  contributionCount
                  contributionLevel
                  weekday
                  date
                }
              }
            }
          }
        }
      }
    `,
    {
      login: username,
      from: `${year}-01-01T00:00:00Z`,
      to: `${year}-12-31T23:59:59Z`,
    },
  );

  return data.user.contributionsCollection.contributionCalendar.weeks.flatMap(
    ({ contributionDays }, x) =>
      contributionDays.map((day) => ({
        x,
        y: day.weekday + yOffset,
        date: day.date,
        count: day.contributionCount,
        level: levelFrom(day.contributionLevel),
      })),
  );
};

const palettes = {
  light: {
    colorDotBorder: "#1b1f230a",
    colorDots: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    colorEmpty: "#ebedf0",
    colorSnake: "purple",
  },
  dark: {
    colorDotBorder: "#1b1f230a",
    colorEmpty: "#161b22",
    colorDots: ["#161b22", "#01311f", "#034525", "#0f6d31", "#00c647"],
    colorSnake: "purple",
  },
};

const drawBase = {
  sizeDotBorderRadius: 2,
  sizeCell: 16,
  sizeDot: 12,
};

const animationOptions = {
  frameByStep: 1,
  stepDurationMs: 100,
};

const startYear = await getCreatedYear();
const currentYear = new Date().getUTCFullYear();
const cells = [];

for (let year = startYear; year <= currentYear; year += 1) {
  const yOffset = (year - startYear) * 8;
  const yearCells = await getYearCells(year, yOffset);
  const dots = yearCells.filter((cell) => cell.count > 0).length;
  console.log(`loaded ${year}: ${yearCells.length} days, ${dots} with contributions`);
  cells.push(...yearCells);
}

const require = createRequire(import.meta.url);
const libFile = require.resolve("generate-snake-animation/generateSnakeAnimation.js");
let source = fs.readFileSync(libFile, "utf8");

if (!source.includes("source.cells")) {
  source = source.replace(
    "const cells = await getUserContribution(source);",
    "const cells = source.cells ?? await getUserContribution(source);",
  );
  fs.writeFileSync(libFile, source);
}

const { generateSnakeAnimation } = await import(pathToFileURL(libFile).href);

fs.mkdirSync(outDir, { recursive: true });

const [lightSvg, darkSvg] = await generateSnakeAnimation(
  {
    platform: "github",
    username,
    githubToken,
    cells,
  },
  [
    {
      format: "svg",
      drawOptions: { ...drawBase, ...palettes.light },
      animationOptions,
    },
    {
      format: "svg",
      drawOptions: { ...drawBase, ...palettes.dark },
      animationOptions,
    },
  ],
);

const withYearLabels = (svg, fill) => {
  const sizeCell = 16;
  const extra = 52;
  const labels = [];

  for (let year = startYear; year <= currentYear; year += 1) {
    const y = ((year - startYear) * 8 + 3.6) * sizeCell;
    labels.push(
      `<text x="-8" y="${y}" font-size="11" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" fill="${fill}" text-anchor="end">${year}</text>`,
    );
  }

  return svg
    .replace(/viewBox="([^"]+)"/, (_, viewBox) => {
      const [x, y, width, height] = viewBox.split(/\s+/).map(Number);
      return `viewBox="${x - extra} ${y} ${width + extra} ${height}"`;
    })
    .replace(/\bwidth="(\d+(?:\.\d+)?)"/, (_, width) => `width="${Number(width) + extra}"`)
    .replace("</svg>", `${labels.join("")}</svg>`);
};

fs.writeFileSync(
  path.join(outDir, "github-contribution-grid-snake.svg"),
  withYearLabels(lightSvg, "#57606a"),
);
fs.writeFileSync(
  path.join(outDir, "github-contribution-grid-snake-dark.svg"),
  withYearLabels(darkSvg, "#8b949e"),
);

console.log(`wrote snakes for ${startYear}-${currentYear} (${cells.length} days)`);
