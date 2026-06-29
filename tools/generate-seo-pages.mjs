import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localizeEntity } from './i18n.mjs';

const DEFAULT_SITE_URL = 'https://r6maps.pages.dev';
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const SEO_MARKER_START = '<!-- r6maps-seo:start -->';
const SEO_MARKER_END = '<!-- r6maps-seo:end -->';

const SEO_COPY = {
  en: {
    titleSuffix: 'Interactive Rainbow Six Siege Map',
    homeTitle: 'R6Maps - Rainbow Six Siege Interactive Maps',
    homeDescription: 'Browse interactive Rainbow Six Siege map layouts, floor plans, callouts, and community marker proposals.',
    description(mapName, floorNames, status) {
      return `Explore the ${mapName} Rainbow Six Siege map with floor layouts for ${floorNames}. Status: ${status}.`;
    },
    statusLabel: 'Map status',
    seasonLabel: 'Season',
    floorsLabel: 'Floors',
    interactiveLink: 'Open interactive map',
    official: 'Official',
    legacy: 'Legacy',
  },
  'zh-CN': {
    titleSuffix: '彩虹六号围攻互动地图',
    homeTitle: 'R6Maps - 彩虹六号围攻互动地图',
    homeDescription: '浏览彩虹六号围攻互动地图、楼层平面图、点位标记和社区提案。',
    description(mapName, floorNames, status) {
      return `查看 ${mapName} 的彩虹六号围攻地图楼层：${floorNames}。状态：${status}。`;
    },
    statusLabel: '地图状态',
    seasonLabel: '赛季',
    floorsLabel: '楼层',
    interactiveLink: '打开互动地图',
    official: '官方',
    legacy: 'Legacy',
  },
  'zh-TW': {
    titleSuffix: '虹彩六號圍攻互動地圖',
    homeTitle: 'R6Maps - 虹彩六號圍攻互動地圖',
    homeDescription: '瀏覽虹彩六號圍攻互動地圖、樓層平面圖、點位標記和社群提案。',
    description(mapName, floorNames, status) {
      return `查看 ${mapName} 的虹彩六號圍攻地圖樓層：${floorNames}。狀態：${status}。`;
    },
    statusLabel: '地圖狀態',
    seasonLabel: '賽季',
    floorsLabel: '樓層',
    interactiveLink: '開啟互動地圖',
    official: '官方',
    legacy: 'Legacy',
  },
  'ja-JP': {
    titleSuffix: 'Rainbow Six Siege インタラクティブマップ',
    homeTitle: 'R6Maps - Rainbow Six Siege インタラクティブマップ',
    homeDescription: 'Rainbow Six Siege のインタラクティブマップ、階層図、コールアウト、コミュニティ提案を確認できます。',
    description(mapName, floorNames, status) {
      return `${mapName} の Rainbow Six Siege マップ階層を確認できます。フロア: ${floorNames}。状態: ${status}。`;
    },
    statusLabel: 'マップ状態',
    seasonLabel: 'シーズン',
    floorsLabel: 'フロア',
    interactiveLink: 'インタラクティブマップを開く',
    official: '公式',
    legacy: 'Legacy',
  },
  'ko-KR': {
    titleSuffix: 'Rainbow Six Siege 인터랙티브 맵',
    homeTitle: 'R6Maps - Rainbow Six Siege 인터랙티브 맵',
    homeDescription: 'Rainbow Six Siege 인터랙티브 맵, 층별 도면, 콜아웃, 커뮤니티 제안을 확인하세요.',
    description(mapName, floorNames, status) {
      return `${mapName} Rainbow Six Siege 맵의 층별 레이아웃을 확인하세요. 층: ${floorNames}. 상태: ${status}.`;
    },
    statusLabel: '맵 상태',
    seasonLabel: '시즌',
    floorsLabel: '층',
    interactiveLink: '인터랙티브 맵 열기',
    official: '공식',
    legacy: 'Legacy',
  },
  'fr-FR': {
    titleSuffix: 'Carte interactive Rainbow Six Siege',
    homeTitle: 'R6Maps - Cartes interactives Rainbow Six Siege',
    homeDescription: 'Consultez les cartes interactives Rainbow Six Siege, les plans des étages, les callouts et les propositions communautaires.',
    description(mapName, floorNames, status) {
      return `Explorez la carte Rainbow Six Siege ${mapName} avec les plans des étages ${floorNames}. Statut : ${status}.`;
    },
    statusLabel: 'Statut de la carte',
    seasonLabel: 'Saison',
    floorsLabel: 'Étages',
    interactiveLink: 'Ouvrir la carte interactive',
    official: 'Officielle',
    legacy: 'Legacy',
  },
  'de-DE': {
    titleSuffix: 'Interaktive Rainbow Six Siege Karte',
    homeTitle: 'R6Maps - Interaktive Rainbow Six Siege Karten',
    homeDescription: 'Durchsuche interaktive Rainbow Six Siege Karten, Grundrisse, Callouts und Community-Vorschläge.',
    description(mapName, floorNames, status) {
      return `Erkunde die Rainbow Six Siege Karte ${mapName} mit Grundrissen für ${floorNames}. Status: ${status}.`;
    },
    statusLabel: 'Kartenstatus',
    seasonLabel: 'Saison',
    floorsLabel: 'Etagen',
    interactiveLink: 'Interaktive Karte öffnen',
    official: 'Offiziell',
    legacy: 'Legacy',
  },
  'es-ES': {
    titleSuffix: 'Mapa interactivo de Rainbow Six Siege',
    homeTitle: 'R6Maps - Mapas interactivos de Rainbow Six Siege',
    homeDescription: 'Explora mapas interactivos de Rainbow Six Siege, planos de plantas, callouts y propuestas de la comunidad.',
    description(mapName, floorNames, status) {
      return `Explora el mapa ${mapName} de Rainbow Six Siege con planos de ${floorNames}. Estado: ${status}.`;
    },
    statusLabel: 'Estado del mapa',
    seasonLabel: 'Temporada',
    floorsLabel: 'Plantas',
    interactiveLink: 'Abrir mapa interactivo',
    official: 'Oficial',
    legacy: 'Legacy',
  },
  'pt-BR': {
    titleSuffix: 'Mapa interativo de Rainbow Six Siege',
    homeTitle: 'R6Maps - Mapas interativos de Rainbow Six Siege',
    homeDescription: 'Veja mapas interativos de Rainbow Six Siege, plantas dos andares, callouts e propostas da comunidade.',
    description(mapName, floorNames, status) {
      return `Explore o mapa ${mapName} de Rainbow Six Siege com plantas para ${floorNames}. Status: ${status}.`;
    },
    statusLabel: 'Status do mapa',
    seasonLabel: 'Temporada',
    floorsLabel: 'Andares',
    interactiveLink: 'Abrir mapa interativo',
    official: 'Oficial',
    legacy: 'Legacy',
  },
  'it-IT': {
    titleSuffix: 'Mappa interattiva di Rainbow Six Siege',
    homeTitle: 'R6Maps - Mappe interattive di Rainbow Six Siege',
    homeDescription: 'Consulta mappe interattive di Rainbow Six Siege, planimetrie, callout e proposte della community.',
    description(mapName, floorNames, status) {
      return `Esplora la mappa ${mapName} di Rainbow Six Siege con planimetrie per ${floorNames}. Stato: ${status}.`;
    },
    statusLabel: 'Stato mappa',
    seasonLabel: 'Stagione',
    floorsLabel: 'Piani',
    interactiveLink: 'Apri mappa interattiva',
    official: 'Ufficiale',
    legacy: 'Legacy',
  },
  'pl-PL': {
    titleSuffix: 'Interaktywna mapa Rainbow Six Siege',
    homeTitle: 'R6Maps - Interaktywne mapy Rainbow Six Siege',
    homeDescription: 'Przegladaj interaktywne mapy Rainbow Six Siege, plany pieter, oznaczenia i propozycje spolecznosci.',
    description(mapName, floorNames, status) {
      return `Poznaj mape ${mapName} do Rainbow Six Siege z planami pieter: ${floorNames}. Status: ${status}.`;
    },
    statusLabel: 'Status mapy',
    seasonLabel: 'Sezon',
    floorsLabel: 'Pietra',
    interactiveLink: 'Otworz interaktywna mape',
    official: 'Oficjalna',
    legacy: 'Legacy',
  },
};

async function main() {
  const [maps, locales, translations] = await Promise.all([
    readJson(path.join(ROOT_DIR, 'public/data/official/maps.json')),
    readJson(path.join(ROOT_DIR, 'public/data/i18n/locales.json')),
    readJson(path.join(ROOT_DIR, 'public/data/community/translations.json')),
  ]);
  const siteUrl = normalizeSiteUrl(process.env.VITE_SITE_URL || process.env.SITE_URL || DEFAULT_SITE_URL);
  const homepage = {
    loc: `${siteUrl}/`,
    lastmod: buildDate(),
  };
  const sitemapEntries = [homepage];

  await updateDistIndex(siteUrl);

  for (const map of maps) {
    for (const locale of locales) {
      const localeId = locale.id;
      const pagePath = mapPagePath(localeId, map.id);
      const outputPath = path.join(DIST_DIR, pagePath, 'index.html');
      const html = renderMapPage({ map, localeId, locales, translations, siteUrl });

      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, html, 'utf8');
      sitemapEntries.push({
        loc: absoluteUrl(siteUrl, pagePath),
        lastmod: map.source?.lastModified ?? map.source?.importedAt ?? homepage.lastmod,
        alternates: localeAlternates(locales, siteUrl, map.id),
      });
    }
  }

  await writeFile(path.join(DIST_DIR, 'sitemap.xml'), renderSitemap(sitemapEntries), 'utf8');
  await writeFile(path.join(DIST_DIR, 'robots.txt'), renderRobots(siteUrl), 'utf8');

  console.log(`Generated ${maps.length * locales.length} SEO map pages, sitemap.xml, and robots.txt for ${siteUrl}`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function updateDistIndex(siteUrl) {
  const indexPath = path.join(DIST_DIR, 'index.html');
  const original = await readFile(indexPath, 'utf8');
  const copy = SEO_COPY.en;
  const seoBlock = [
    SEO_MARKER_START,
    `    <meta name="description" content="${escapeAttribute(copy.homeDescription)}" />`,
    `    <link rel="canonical" href="${escapeAttribute(`${siteUrl}/`)}" />`,
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:site_name" content="R6Maps" />`,
    `    <meta property="og:title" content="${escapeAttribute(copy.homeTitle)}" />`,
    `    <meta property="og:description" content="${escapeAttribute(copy.homeDescription)}" />`,
    `    <meta property="og:url" content="${escapeAttribute(`${siteUrl}/`)}" />`,
    `    <meta name="twitter:card" content="summary" />`,
    SEO_MARKER_END,
  ].join('\n');
  const withoutExistingBlock = original.replace(new RegExp(`\\n?\\s*${escapeRegExp(SEO_MARKER_START)}[\\s\\S]*?${escapeRegExp(SEO_MARKER_END)}`, 'g'), '');
  const withTitle = withoutExistingBlock.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(copy.homeTitle)}</title>`);

  if (withTitle.includes('</head>')) {
    await writeFile(indexPath, withTitle.replace('</head>', `  ${seoBlock}\n  </head>`), 'utf8');
    return;
  }

  throw new Error('dist/index.html does not contain a closing </head> tag');
}

function renderMapPage({ map, localeId, locales, translations, siteUrl }) {
  const copy = SEO_COPY[localeId] ?? SEO_COPY.en;
  const mapName = localizeEntity({
    entityType: 'map',
    entityId: map.id,
    field: 'name',
    fallback: map.name,
    locale: localeId,
    translations,
  });
  const floors = sortedFloors(map.floors);
  const localizedFloors = floors.map((floor) => ({
    ...floor,
    localizedName: localizeEntity({
      entityType: 'floor',
      entityId: floor.id,
      field: 'name',
      fallback: floor.name,
      locale: localeId,
      translations,
    }),
  }));
  const floorNames = localizedFloors.map((floor) => floor.localizedName).join(', ');
  const status = map.status === 'official' ? copy.official : copy.legacy;
  const title = `${mapName} - ${copy.titleSuffix} | R6Maps`;
  const description = copy.description(mapName, floorNames, status);
  const canonicalPath = mapPagePath(localeId, map.id);
  const canonicalUrl = absoluteUrl(siteUrl, canonicalPath);
  const alternates = localeAlternates(locales, siteUrl, map.id);
  const firstFloor = floors[0]?.id ?? 'all';
  const interactiveUrl = `/#${encodeURIComponent(map.id)}/${encodeURIComponent(firstFloor)}/all`;
  const imageUrl = firstMapImageUrl(siteUrl, floors);

  return `<!doctype html>
<html lang="${escapeAttribute(localeId)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttribute(description)}" />
    <link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />
${alternates.map((alternate) => `    <link rel="alternate" hreflang="${escapeAttribute(alternate.locale)}" href="${escapeAttribute(alternate.href)}" />`).join('\n')}
    <link rel="alternate" hreflang="x-default" href="${escapeAttribute(absoluteUrl(siteUrl, mapPagePath('en', map.id)))}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="R6Maps" />
    <meta property="og:title" content="${escapeAttribute(title)}" />
    <meta property="og:description" content="${escapeAttribute(description)}" />
    <meta property="og:url" content="${escapeAttribute(canonicalUrl)}" />
    <meta property="og:locale" content="${escapeAttribute(localeId.replace('-', '_'))}" />
${imageUrl ? `    <meta property="og:image" content="${escapeAttribute(imageUrl)}" />\n` : ''}    <meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <style>
      :root {
        color-scheme: dark;
        background: #101216;
        color: #f4f7fb;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
      }
      main {
        box-sizing: border-box;
        width: min(880px, 100%);
        min-height: 100vh;
        padding: 48px 20px;
        margin: 0 auto;
      }
      a {
        color: #76d6ff;
      }
      .eyebrow {
        margin: 0 0 12px;
        color: #9da8b8;
        font-size: 0.875rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0 0 16px;
        font-size: clamp(2.25rem, 7vw, 5rem);
        line-height: 0.95;
      }
      p {
        max-width: 680px;
        color: #c7d0df;
        font-size: 1.1rem;
        line-height: 1.65;
      }
      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 10px 20px;
        margin: 32px 0;
      }
      dt {
        color: #9da8b8;
      }
      dd {
        margin: 0;
      }
      ul {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 10px;
        padding: 0;
        list-style: none;
      }
      li {
        border: 1px solid #2c3441;
        border-radius: 8px;
        padding: 12px 14px;
        background: #171b22;
      }
      .primary-link {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
        padding: 0 18px;
        border-radius: 8px;
        background: #e9f7ff;
        color: #101216;
        font-weight: 700;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">R6Maps</p>
      <h1>${escapeHtml(mapName)}</h1>
      <p>${escapeHtml(description)}</p>
      <dl>
        <dt>${escapeHtml(copy.statusLabel)}</dt>
        <dd>${escapeHtml(status)}</dd>
        <dt>${escapeHtml(copy.seasonLabel)}</dt>
        <dd>${escapeHtml(map.season)}</dd>
      </dl>
      <h2>${escapeHtml(copy.floorsLabel)}</h2>
      <ul>
${localizedFloors.map((floor) => `        <li>${escapeHtml(floor.localizedName)}</li>`).join('\n')}
      </ul>
      <p><a class="primary-link" href="${escapeAttribute(interactiveUrl)}">${escapeHtml(copy.interactiveLink)}</a></p>
    </main>
  </body>
</html>
`;
}

function sortedFloors(floors) {
  return [...(Array.isArray(floors) ? floors : [])].sort((left, right) => {
    const sortDelta = Number(left.sort ?? 0) - Number(right.sort ?? 0);

    return sortDelta || String(left.id).localeCompare(String(right.id));
  });
}

function firstMapImageUrl(siteUrl, floors) {
  const floor = floors.find((item) => typeof item.image === 'string' && item.image.trim() !== '');

  return floor ? absoluteUrl(siteUrl, `/${floor.image}`) : null;
}

function localeAlternates(locales, siteUrl, mapId) {
  return locales.map((locale) => ({
    locale: locale.id,
    href: absoluteUrl(siteUrl, mapPagePath(locale.id, mapId)),
  }));
}

function mapPagePath(localeId, mapId) {
  const encodedMapId = encodeURIComponent(mapId);

  return localeId === 'en' ? `/maps/${encodedMapId}/` : `/${encodeURIComponent(localeId)}/maps/${encodedMapId}/`;
}

function renderSitemap(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.map(renderSitemapEntry).join('\n')}
</urlset>
`;
}

function renderSitemapEntry(entry) {
  const alternates = entry.alternates ?? [];

  return `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${escapeXml(toSitemapDate(entry.lastmod))}</lastmod>
${alternates.map((alternate) => `    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.locale)}" href="${escapeXml(alternate.href)}" />`).join('\n')}
${alternates.length > 0 ? `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(alternates.find((alternate) => alternate.locale === 'en')?.href ?? entry.loc)}" />\n` : ''}  </url>`;
}

function renderRobots(siteUrl) {
  return `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;
}

function normalizeSiteUrl(value) {
  const candidate = String(value ?? '').trim() || DEFAULT_SITE_URL;

  try {
    const url = new URL(candidate);
    url.hash = '';
    url.search = '';

    return url.toString().replace(/\/+$/, '');
  } catch {
    return DEFAULT_SITE_URL;
  }
}

function absoluteUrl(siteUrl, pathname) {
  return `${siteUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function buildDate() {
  return new Date().toISOString();
}

function toSitemapDate(value) {
  const date = new Date(value);

  return Number.isNaN(date.valueOf()) ? buildDate() : date.toISOString();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function escapeXml(value) {
  return escapeHtml(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
