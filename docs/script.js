/**************************************************************
 * GLOBAL STATE & CONSTANTS
 **************************************************************/
let allPlayers = [];
let worldGeo = null;

let currentGender = "ALL";
let currentCountry = null;
let tableMode = "country";

let brushedPlayers = null; // for selection summary
let clusterMeta = [];      // {index, color, label}
let currentClusterSelection = null;

let leagueViewMode = "league-strength";

let finderCriteria = {
  min: 80,
  max: 99,
  role: "any",
  cluster: "any"
};


let activePlayerKey = null;
let activePlayer = null;
function playerKey(p) {
  if (!p) return null;
  return `${p.Name || ''}||${p.Team || ''}||${p.Nation || ''}`;
}

// Shape generator for 7 clusters (returns SVG path for different shapes)
function getClusterShape(clusterIndex, x, y, size) {
  const s = size;
  switch (clusterIndex) {
    case 0: // Circle
      return { type: 'circle', cx: x, cy: y, r: s };
    case 1: // Square
      return { type: 'rect', x: x - s, y: y - s, width: s * 2, height: s * 2 };
    case 2: // Triangle (up)
      return { type: 'path', d: `M ${x},${y - s * 1.2} L ${x - s},${y + s * 0.6} L ${x + s},${y + s * 0.6} Z` };
    case 3: // Diamond
      return { type: 'path', d: `M ${x},${y - s} L ${x + s},${y} L ${x},${y + s} L ${x - s},${y} Z` };
    case 4: // Star
      const points = [];
      for (let i = 0; i < 5; i++) {
        const angle = (i * 4 * Math.PI / 5) - Math.PI / 2;
        const r = i % 2 === 0 ? s : s * 0.4;
        points.push([x + r * Math.cos(angle), y + r * Math.sin(angle)]);
      }
      return { type: 'path', d: points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]},${p[1]}`).join(' ') + ' Z' };
    case 5: // Cross
      const w = s * 0.35;
      return { type: 'path', d: `M ${x - w},${y - s} L ${x + w},${y - s} L ${x + w},${y - w} L ${x + s},${y - w} L ${x + s},${y + w} L ${x + w},${y + w} L ${x + w},${y + s} L ${x - w},${y + s} L ${x - w},${y + w} L ${x - s},${y + w} L ${x - s},${y - w} L ${x - w},${y - w} Z` };
    case 6: // Pentagon
      const penPoints = [];
      for (let i = 0; i < 5; i++) {
        const angle = (i * 2 * Math.PI / 5) - Math.PI / 2;
        penPoints.push([x + s * Math.cos(angle), y + s * Math.sin(angle)]);
      }
      return { type: 'path', d: penPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]},${p[1]}`).join(' ') + ' Z' };
    default:
      return { type: 'circle', cx: x, cy: y, r: s };
  }
}

/*
 * Tile 9: Radial Attribute Contribution Explainability
 * Unique radial format: six radial bars (spokes) showing contribution points
 * for attributes PAC, SHO, PAS, DRI, DEF, PHY. Inner circle shows OVR.
 */
function drawAttributeRadial() {
  const container = d3.select('#tile-9');
  if (container.empty()) return;
  container.selectAll('*').remove();

  const players = getFilteredPlayers();
  if (!players || !players.length) {
    container.append('div').attr('class','tile9-title').style('color','#9ca3af').text('No players available.');
    return;
  }

  const ATTRS = ['PAC','SHO','PAS','DRI','DEF','PHY'];

  // pick source: brushed average if present, else activePlayer by key, else top OVR
  const isBrushed = Array.isArray(brushedPlayers) && brushedPlayers.length > 0;
  const sourcePlayers = isBrushed ? brushedPlayers : null;

  let resolved = null;
  if (!isBrushed && activePlayerKey) resolved = players.find(p => playerKey(p) === activePlayerKey) || null;
  if (!isBrushed && !resolved) resolved = players.slice().sort((a,b) => (b.OVR||0)-(a.OVR||0))[0] || null;

  function valOf(p,a){ const v = p && p[a]; return (v==null || isNaN(Number(v)))?0:Number(v); }

  let attrVals = [];
  let baseOVR = 0;
  if (isBrushed) {
    const n = sourcePlayers.length;
    attrVals = ATTRS.map(a => d3.sum(sourcePlayers, d => valOf(d,a))/n);
    baseOVR = d3.mean(sourcePlayers, d => valOf(d,'OVR')) || 0;
  } else {
    attrVals = ATTRS.map(a => valOf(resolved,a));
    baseOVR = valOf(resolved,'OVR') || 0;
  }

  // keep original proxy: contribution fraction * OVR -> points
  const sumVals = d3.sum(attrVals) || 1;
  const frac = attrVals.map(v => v / sumVals);
  const points = frac.map(f => f * baseOVR);

  // bright palette for the six attributes (Tile 9 data points)
  const POINT_COLORS = ["#06B6D4","#16A34A","#F59E0B","#F97316","#EF4444","#8B5CF6"];

  // layout: horizontal split — svg left, attribute list right (like attachment)
  const containerW = container.node().clientWidth || 420;
  const containerH = container.node().clientHeight || 260;
  const svgW = Math.max(220, Math.floor(containerW * 0.66));
  const legendW = Math.max(100, Math.floor(containerW * 0.32));

  const svg = container.append('svg').attr('width', svgW).attr('height', containerH).attr('class','tile9-svg');
  const legend = container.append('div').attr('class','tile9-legend').style('width', legendW + 'px').style('margin-left','12px');

  const cx = svgW/2; const cy = containerH/2;
  const maxRadius = Math.min(svgW, containerH) * 0.36;
  const innerR = Math.max(28, maxRadius * 0.28);
  const outerR = maxRadius;

  const maxPts = d3.max(points) || 1;
  const rScale = d3.scaleLinear().domain([0, maxPts]).range([innerR, outerR]);

  const angleStep = (2*Math.PI)/ATTRS.length;

  const g = svg.append('g');

  // draw hex grid (rings) as polygons
  const rings = [0.33, 0.66, 1.0];
  rings.forEach((t,i) => {
    const r = innerR + (outerR - innerR) * t;
    const pts = ATTRS.map((a,j) => [cx + r*Math.cos(j*angleStep - Math.PI/2), cy + r*Math.sin(j*angleStep - Math.PI/2)]);
    g.append('path').attr('d', d3.line()(pts.concat([pts[0]]))).attr('fill','none').attr('stroke','#02551eff').attr('stroke-width',1);
  });

  // compute polygon points for data
  const dataPts = points.map((pt,i) => {
    const r = rScale(pt || 0);
    const ang = i*angleStep - Math.PI/2; // start at top
    return [cx + r*Math.cos(ang), cy + r*Math.sin(ang)];
  });

  // background filled polygon (muted grey fill + edge)
  g.append('path')
    .attr('d', d3.line().curve(d3.curveLinearClosed)(dataPts))
    .attr('fill', 'rgba(204, 210, 221, 0.41)')
    .attr('stroke', '#6b7280')
    .attr('stroke-width', 2);

  // draw attribute spokes and small endpoint circles
  ATTRS.forEach((a,i)=>{
    const ang = i*angleStep - Math.PI/2;
    const xEnd = cx + outerR*Math.cos(ang);
    const yEnd = cy + outerR*Math.sin(ang);
    g.append('line').attr('x1', cx).attr('y1', cy).attr('x2', xEnd).attr('y2', yEnd).attr('stroke','#7f8082ff').attr('stroke-width',1);

    // endpoint marker for data (bright fill, grey edge)
    const dp = dataPts[i];
    g.append('circle').attr('cx', dp[0]).attr('cy', dp[1]).attr('r', 6).attr('fill', POINT_COLORS[i % POINT_COLORS.length]).attr('stroke','#374151').attr('stroke-width',1.5)
      .on('mouseover', () => {
        const raw = Math.round(attrVals[i]||0);
        const pts = (points[i]||0).toFixed(2);
        const pct = ((points[i]||0)/(d3.sum(points)||1)*100).toFixed(1)+'%';
        tooltip.style('opacity',1).html(`<strong>${a}</strong><br>Raw: ${raw}<br>Points: ${pts}<br>Share: ${pct}`);
      })
      .on('mousemove', e => tooltip.style('left', e.pageX+12+'px').style('top', e.pageY-28+'px'))
      .on('mouseout', () => tooltip.style('opacity',0));
  });

  // center OVR label & player name
  const ovrVal = isBrushed ? (d3.mean(sourcePlayers,d=>d.OVR)||0) : baseOVR;
  g.append('circle').attr('cx', cx).attr('cy', cy).attr('r', innerR-8).attr('fill','#071023');
  g.append('text').attr('x', cx).attr('y', cy-6).attr('class','tile9-center-label').text((ovrVal||0).toFixed(1));
  const nameLabel = isBrushed ? 'Brushed avg' : (resolved ? (resolved.Name || '') : '');
  g.append('text').attr('x', cx).attr('y', cy+14).attr('fill','#9ca3af').attr('font-size',11).attr('text-anchor','middle').text(nameLabel);

  // right-side attribute list in legend area (large values like attachment)
  legend.style('display','flex').style('flex-direction','column').style('gap','6px').style('padding-top','8px');
  ATTRS.forEach((a,i)=>{
    const row = legend.append('div').style('display','flex').style('justify-content','space-between').style('align-items','center');
    const left = row.append('div').style('display','flex').style('gap','8px').style('align-items','center');
    left.append('div').style('width','10px').style('height','10px').style('background', POINT_COLORS[i%POINT_COLORS.length]).style('border-radius','2px');
    left.append('div').style('color','#cbd5e1').style('font-size','14px').text(a);
    row.append('div').style('color','#fff').style('font-size','18px').style('font-weight','600').text(Math.round(attrVals[i]||0));
  });
  // final OVR at top of legend
  legend.insert('div', ':first-child').style('display','flex').style('justify-content','space-between').style('align-items','center').style('margin-bottom','6px')
    .html(`<div style="color:#cbd5e1">OVR</div><div style="color:#fff;font-size:20px;font-weight:700">${(ovrVal||0).toFixed(1)}</div>`);
}
function setActivePlayer(p) {
  activePlayer = p || null;
  activePlayerKey = playerKey(p);
  try { refreshAllVisuals(); } catch (e) { /* refresh may not be ready yet */ }
}

const tooltip = d3.select("#tooltip");

// World map colour bins
const zeroColor = "#ffffffff";
const greenBins = [
  { min: 1,    max: 250,    color: "#c0f7c5ff" },
  { min: 251,  max: 500,    color: "#98f59bff" },
  { min: 501,  max: 750,    color: "#5cc561ff" },
  { min: 751,  max: 1000,   color: "#3aa13fff" },
  { min: 1001, max: 1250,   color: "#216c25ff" },
  { min: 1251, max: 999999, color: "#063e09ff" }
];

function getCountryColor(count) {
  if (!count || count === 0) return zeroColor;
  for (const b of greenBins) {
    if (count >= b.min && count <= b.max) return b.color;
  }
  return greenBins[greenBins.length - 1].color;
}

function getCountryPattern(count) {
  if (!count || count === 0) return 'url(#map-zero)';
  if (count <= 250) return 'url(#map-1)';
  if (count <= 500) return 'url(#map-2)';
  if (count <= 750) return 'url(#map-3)';
  if (count <= 1000) return 'url(#map-4)';
  if (count <= 1250) return 'url(#map-5)';
  return 'url(#map-6)';
}

/*
 * Squad Composition vs Ideal Formation (Cell 7)
*/
function drawSquadComposition() {
  const container = d3.select("#squad-composition");
  container.selectAll("*").remove();
  // Ensure container uses available space and centers content
  container.style('width', '100%').style('height', '100%')
    .style('display', 'flex').style('flex-direction', 'column')
    .style('justify-content', 'center').style('align-items', 'center');

  const players = getFilteredPlayers();
  if (!players || !players.length) {
    container.append("div")
      .attr("class", "empty-message")
      .style("color", "#9ca3af")
      .text("No players selected.");
    return;
  }

  // Map detailed positions into four role groups
  const roleMap = {
    GK: 'GK',
    // defenders
    CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF', SW: 'DEF',
    // midfield
    CM: 'MID', CDM: 'MID', CAM: 'MID', LM: 'MID', RM: 'MID', LAM: 'MID', RAM: 'MID',
    // attackers
    ST: 'ATT', CF: 'ATT', LW: 'ATT', RW: 'ATT'
  };

  const counts = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  players.forEach(p => {
    const pos = (p.Position || '').toUpperCase();
    const role = roleMap[pos] || (
      // fallback heuristic: use DEF if position contains 'B', ATT if contains 'W' or 'F' or 'ST', else MID
      (pos.includes('B') ? 'DEF' : (pos.includes('W') || pos.includes('F') || pos.includes('ST') ? 'ATT' : 'MID'))
    );
    counts[role] = (counts[role] || 0) + 1;
  });

  const total = counts.GK + counts.DEF + counts.MID + counts.ATT;

  // IDEAL distribution (fixed reference model)
  // Values: GK 8%, DEF 33%, MID 33%, ATT 26%
  const IDEAL = { GK: 0.08, DEF: 0.33, MID: 0.33, ATT: 0.26 };

  // Prepare data array
  const roles = ['GK', 'DEF', 'MID', 'ATT'];
  const data = roles.map(r => ({
    role: r,
    count: counts[r],
    actualPct: total ? counts[r] / total : 0,
    idealPct: IDEAL[r]
  }));

  // Chart dimensions (responsive within cell) - base on container itself
  const cWidth = container.node().clientWidth || container.node().parentNode.clientWidth || 320;
  const cHeight = Math.max(180, Math.min(260, container.node().clientHeight || 220));
  const width = Math.max(260, cWidth - 20);
  const height = cHeight;
  // reduce radius slightly to allow decorative outer ring to extend
  const radius = Math.min(width, height) / 2 - 18;

  // Use responsive SVG via viewBox so it scales within the card
  const svg = container.append('svg')
    .attr('width', '100%')
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('class', 'fade-in');

  const g = svg.append('g')
    .attr('transform', `translate(${width/2},${height/2})`);

  // Role colours (dark techy theme):
  // GK - warm yellow (slightly less transparent), DEF - pink/purple, MID - green, ATT - blue
  const ROLE_COLORS = {
    GK: '#F59E0BE6', // warm yellow, a bit translucent for dark background
    DEF: '#C084FCE6', // pink/purple
    MID: '#34D399FF', // green
    ATT: '#3B82F6FF'  // blue
  };

  // Pie for actual composition (inner donut)
  const pie = d3.pie()
    .sort(null)
    .value(d => d.actualPct);

  const arcInner = d3.arc()
    .innerRadius(radius * 0.50)
    .outerRadius(radius * 0.78)
    .cornerRadius(6);

  // Decorative outer ring — slightly larger and styled with gradients + dashes
  const arcOuter = d3.arc()
    .innerRadius(radius * 0.86)
    .outerRadius(radius * 1.05)
    .cornerRadius(4);

  // defs for gradients and patterns used on outer strokes
  const defs = svg.append('defs');
  
  // Add texture patterns for accessibility
  const patterns = {
    GK: 'horizontal',
    DEF: 'diagonal',
    MID: 'dots',
    ATT: 'vertical'
  };
  
  Object.entries(patterns).forEach(([role, patternType]) => {
    const pattern = defs.append('pattern')
      .attr('id', `pattern-${role}`)
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 8)
      .attr('height', 8);
    
    const col = ROLE_COLORS[role];
    pattern.append('rect').attr('width', 8).attr('height', 8).attr('fill', col);
    
    if (patternType === 'horizontal') {
      pattern.append('line').attr('x1', 0).attr('y1', 4).attr('x2', 8).attr('y2', 4)
        .attr('stroke', 'rgba(0,0,0,0.3)').attr('stroke-width', 1.5);
    } else if (patternType === 'vertical') {
      pattern.append('line').attr('x1', 4).attr('y1', 0).attr('x2', 4).attr('y2', 8)
        .attr('stroke', 'rgba(0,0,0,0.3)').attr('stroke-width', 1.5);
    } else if (patternType === 'diagonal') {
      pattern.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 8).attr('y2', 8)
        .attr('stroke', 'rgba(0,0,0,0.3)').attr('stroke-width', 1.5);
    } else if (patternType === 'dots') {
      pattern.append('circle').attr('cx', 4).attr('cy', 4).attr('r', 1.5)
        .attr('fill', 'rgba(0,0,0,0.4)');
    }
  });
  
  data.forEach(d => {
    const col = ROLE_COLORS[d.role];
    const id = `grad-${d.role}`;
    const lg = defs.append('linearGradient').attr('id', id).attr('x1', '0%').attr('x2', '100%');
    lg.append('stop').attr('offset', '0%').attr('stop-color', d3.color(col).darker(0.6));
    lg.append('stop').attr('offset', '100%').attr('stop-color', d3.color(col).brighter(0.8));
  });

  // Draw actual donut segments
  const arcs = g.selectAll('.arc')
    .data(pie(data))
    .enter()
    .append('g')
    .attr('class', 'arc');

  arcs.append('path')
    .attr('d', arcInner)
    .attr('fill', d => `url(#pattern-${d.data.role})`)
    .attr('opacity', 0.95)
    .on('mouseover', (event, d) => {
      const diff = ((d.data.actualPct - d.data.idealPct) * 100).toFixed(1);
      tooltip.style('opacity', 1).html(`
        <strong>${d.data.role}</strong><br>
        Actual: ${(d.data.actualPct*100).toFixed(1)}%<br>
        Ideal: ${(d.data.idealPct*100).toFixed(1)}%<br>
        Diff: ${diff}%
      `);
    })
    .on('mousemove', event => {
      tooltip.style('left', event.pageX + 12 + 'px').style('top', event.pageY - 28 + 'px');
    })
    .on('mouseout', () => tooltip.style('opacity', 0));

  // Draw outer ideal markers as thin arcs
  const idealPie = d3.pie().sort(null).value(d => d.idealPct);
  g.selectAll('.ideal')
    .data(idealPie(data))
    .enter()
    .append('path')
    .attr('class', 'ideal')
    .attr('d', arcOuter)
    .attr('fill', 'none')
    .attr('stroke', d => `url(#grad-${d.data.role})`)
    .attr('stroke-width', 6)
    .attr('stroke-linecap', 'round')
    .attr('stroke-dasharray', '4 4')
    .attr('stroke-opacity', 0.95)
    .on('mouseover', (event, d) => {
      const diff = ((d.data.actualPct - d.data.idealPct) * 100).toFixed(1);
      tooltip.style('opacity', 1).html(`
        <strong>${d.data.role} (ideal)</strong><br>
        Actual: ${(d.data.actualPct*100).toFixed(1)}%<br>
        Ideal: ${(d.data.idealPct*100).toFixed(1)}%<br>
        Diff: ${diff}%
      `);
    })
    .on('mousemove', event => {
      tooltip.style('left', event.pageX + 12 + 'px').style('top', event.pageY - 28 + 'px');
    })
    .on('mouseout', () => tooltip.style('opacity', 0));

  // Center label: total players
  g.append('text')
    .attr('text-anchor', 'middle')
    .attr('y', 4)
    .attr('fill', '#e5e7eb')
    .attr('font-size', '12px')
    .text(`${total} players`);

  // Inline legend (centered below chart)
  const legend = container.append('div')
    .attr('class', 'squad-legend')
    .style('display', 'flex')
    .style('gap', '12px')
    .style('justify-content', 'center')
    .style('margin-top', '8px')
    .style('flex-wrap', 'wrap');

  const legItems = legend.selectAll('.leg-item')
    .data(data)
    .enter()
    .append('div')
    .attr('class', 'leg-item')
    .style('display', 'flex')
    .style('gap', '6px')
    .style('align-items', 'center')
    .style('color', '#cbd5e1')
    .style('font-size', '11px');

  legItems.each(function(d) {
    const item = d3.select(this);
    const svg = item.append('svg')
      .style('width', '12px')
      .style('height', '12px')
      .style('display', 'block');
    svg.append('rect')
      .attr('width', 12)
      .attr('height', 12)
      .attr('rx', 2)
      .attr('fill', `url(#pattern-${d.role})`);
  });

  legItems.append('div')
    .text(d => `${d.role} ${ (d.count>0 ? d.count : 0) } (${(d.actualPct*100).toFixed(0)}%)`);

  // Small note about outer ring meaning
  container.append('div')
    .style('text-align', 'center')
    .style('color', '#9ca3af')
    .style('font-size', '11px')
    .style('margin-top', '4px')
    .text('Inner = Actual composition · Outer ring = Ideal reference');
}

let currentCountsMap = new Map();

// ------------------------------------------------------------------
// Clustering: compute once, deterministic K-means with GK cluster (0)
// ------------------------------------------------------------------
let clustersComputed = false;


const CLUSTER_LABELS = {
  0: "Goalkeepers",
  1: "Technical Finishers",
  2: "Flashy Dribblers",
  3: "Creative Playmakers",
  4: "Possession Controllers",
  5: "Physical Walls",
  6: "Tackle Specialists"
};


const CLUSTER_COLORS = [
  "#fbbf24", // C1 Goalkeepers
  "#5ca3efff", // C2 Physical Defenders
  "#005ab9ff", // C3 Defensive Specialists
  "#2dd4bf", // C4 Midfield Controllers
  "#009176ff", // C5 Creative Playmakers
  "#e969d2ff", // C6 Technical Finishers
  "#c4007cff"  // 6: cyan-teal
];

function computeClusters(players) {
  const ATTRS = [
    "PAC","SHO","PAS","DRI","DEF","PHY",
    "Acceleration","Sprint Speed","Positioning","Finishing","Shot Power",
    "Long Shots","Volleys","Penalties","Vision","Crossing",
    "Free Kick Accuracy","Short Passing","Long Passing","Curve","Dribbling",
    "Agility","Balance","Reactions","Ball Control","Composure",
    "Interceptions","Heading Accuracy","Def Awareness","Standing Tackle",
    "Sliding Tackle","Jumping","Stamina","Strength","Aggression","Position"
  ];

  const K_OUTFIELD = 6; 

  // Split GK vs outfield
  const outfield = [];
  players.forEach(p => {
    if (p.Position === "GK") {
      p.clusterId = 0;
      p.clusterLabel = CLUSTER_LABELS[0];
    } else {
      outfield.push(p);
    }
  });

  if (outfield.length === 0) return players;

  // Build numeric matrix for outfield players
  const X = outfield.map(p => ATTRS.map(a => {
    const v = p[a];
    return typeof v === 'number' ? v : (v == null ? 0 : (isNaN(Number(v)) ? 0 : Number(v)));
  }));

  const n = X.length;
  const d = ATTRS.length;

  // Z-score normalisation
  const means = Array(d).fill(0);
  const stds = Array(d).fill(0);
  for (let j = 0; j < d; j++) {
    means[j] = X.reduce((s, r) => s + r[j], 0) / n;
    stds[j] = Math.sqrt(X.reduce((s, r) => s + (r[j] - means[j]) ** 2, 0) / n) || 1;
  }
  const Z = X.map(r => r.map((v, j) => (v - means[j]) / stds[j]));

  const attrIndex = name => ATTRS.indexOf(name);

  // Score vectors for targeted seeds (use Z-normalised values)
  const scores = {
    finisher: [],
    dribbler: [],
    playmaker: [],
    possession: [],
    physical: [],
    tackler: []
  };

  for (let i = 0; i < n; i++) {
    const row = Z[i];
    const get = names => names.reduce((s, a) => {
      const idx = attrIndex(a);
      return s + (idx >= 0 ? row[idx] : 0);
    }, 0);

    scores.finisher.push(get(["SHO","Finishing","Shot Power","Long Shots","Volleys","Penalties"]));
    scores.dribbler.push(get(["DRI","Dribbling","Agility","Ball Control","Balance","Curve"]));
    scores.playmaker.push(get(["PAS","Vision","Short Passing","Long Passing","Ball Control","Composure"]));
    scores.possession.push(get(["PAS","Composure","Short Passing","Ball Control","Reactions"]));
    scores.physical.push(get(["PHY","Strength","Jumping","Stamina","Heading Accuracy"]));
    scores.tackler.push(get(["DEF","Standing Tackle","Sliding Tackle","Interceptions","Def Awareness"]));
  }

  // Helper to pick top index for a score array avoiding duplicates
  function pickTop(scoreArr, used) {
    const order = scoreArr
      .map((v, i) => ({ i, v }))
      .sort((a, b) => b.v - a.v);
    for (const o of order) if (!used.has(o.i)) return o.i;
    return order.length ? order[0].i : 0;
  }

  const used = new Set();
  const seeds = [];
  // Sequence: finisher, dribbler, playmaker, possession, physical, tackler
  seeds.push(pickTop(scores.finisher, used)); used.add(seeds[seeds.length-1]);
  seeds.push(pickTop(scores.dribbler, used)); used.add(seeds[seeds.length-1]);
  seeds.push(pickTop(scores.playmaker, used)); used.add(seeds[seeds.length-1]);
  seeds.push(pickTop(scores.possession, used)); used.add(seeds[seeds.length-1]);
  seeds.push(pickTop(scores.physical, used)); used.add(seeds[seeds.length-1]);
  seeds.push(pickTop(scores.tackler, used)); used.add(seeds[seeds.length-1]);

  // Fallback: if any seed is undefined, use evenly spaced index
  const sortedIdx = outfield.map((p, i) => ({ i, ovr: p.OVR || 0 }))
    .sort((a, b) => b.ovr - a.ovr)
    .map(d => d.i);
  for (let k = 0; k < K_OUTFIELD; k++) {
    if (seeds[k] == null || seeds[k] < 0 || seeds[k] >= n) {
      seeds[k] = sortedIdx[Math.floor((k / K_OUTFIELD) * sortedIdx.length)];
    }
  }

  let centroids = seeds.map(idx => [...Z[idx]]);

  // Now perform constrained clustering: attackers → clusters 1&2, midfield → 3&4, defenders → 5&6
  const attackRoles = ["ST", "CF", "LW", "RW", "LM", "RM", "SS", "LF", "RF"];
  const midRoles = ["CAM", "CM", "CDM", "LAM", "RAM", "RM", "LM"];
  const defRoles = ["CB", "LB", "RB", "LWB", "RWB", "SW"];

  // Build index lists for groups (indices into outfield array)
  const attackIdx = [];
  const midIdx = [];
  const defIdx = [];
  for (let i = 0; i < outfield.length; i++) {
    const pos = (outfield[i].Position || "").toUpperCase();
    if (attackRoles.includes(pos)) attackIdx.push(i);
    else if (midRoles.includes(pos)) midIdx.push(i);
    else if (defRoles.includes(pos)) defIdx.push(i);
    else {
      // fallback by simple attribute heuristic (attack vs mid vs def)
      const row = Z[i];
      const atk = (row[attrIndex("SHO")] || 0) + (row[attrIndex("DRI")] || 0) + (row[attrIndex("PAC")] || 0);
      const mid = (row[attrIndex("PAS")] || 0) + (row[attrIndex("DRI")] || 0);
      const def = (row[attrIndex("DEF")] || 0) + (row[attrIndex("Standing Tackle")] || 0) + (row[attrIndex("Interceptions")] || 0);
      if (atk >= mid && atk >= def) attackIdx.push(i);
      else if (def >= atk && def >= mid) defIdx.push(i);
      else midIdx.push(i);
    }
  }

  // Helper: cluster two groups with seeded centroids based on score arrays
  function clusterTwo(indices, scoreAName, scoreBName) {
    const assign = {};
    if (indices.length === 0) return assign;
    if (indices.length === 1) {
      assign[indices[0]] = 0;
      return assign;
    }

    const scoreA = scores[scoreAName];
    const scoreB = scores[scoreBName];

    // pick best two distinct seeds within indices
    let bestA = indices.reduce((best, idx) => (scoreA[idx] > (scoreA[best] || -Infinity) ? idx : best), indices[0]);
    let bestB = indices.reduce((best, idx) => (scoreB[idx] > (scoreB[best] || -Infinity) ? idx : best), indices[0]);
    if (bestA === bestB) {
      // pick second best for B
      let second = null;
      let bestVal = -Infinity;
      for (const idx of indices) {
        if (idx === bestA) continue;
        if ((scoreB[idx] || -Infinity) > bestVal) { bestVal = scoreB[idx]; second = idx; }
      }
      if (second != null) bestB = second;
      else {
        // fallback: pick a different index
        bestB = indices.find(i => i !== bestA) || bestA;
      }
    }

    let cent = [ [...Z[bestA]], [...Z[bestB]] ];

    // K-means on subset
    const localIndices = indices.slice();
    for (let it = 0; it < 25; it++) {
      const sums = [Array(d).fill(0), Array(d).fill(0)];
      const counts = [0, 0];
      for (const idx of localIndices) {
        // compute dist to centroids
        let best = 0; let bestDist = Infinity;
        for (let c = 0; c < 2; c++) {
          let dist = 0;
          for (let j = 0; j < d; j++) { const diff = Z[idx][j] - cent[c][j]; dist += diff * diff; }
          if (dist < bestDist) { bestDist = dist; best = c; }
        }
        assign[idx] = best;
        counts[best]++;
        for (let j = 0; j < d; j++) sums[best][j] += Z[idx][j];
      }
      for (let c = 0; c < 2; c++) {
        if (counts[c] > 0) cent[c] = sums[c].map(v => v / counts[c]);
      }
    }
    return assign;
  }

  // Cluster each group
  const attackAssign = clusterTwo(attackIdx, 'finisher', 'dribbler');
  const midAssign = clusterTwo(midIdx, 'playmaker', 'possession');
  const defAssign = clusterTwo(defIdx, 'physical', 'tackler');

  // Attach cluster ids according to group mapping
  outfield.forEach((p, i) => {
    let cid = 1; // default to first attacker
    if (i in attackAssign) {
      cid = 1 + (attackAssign[i] || 0);
    } else if (i in midAssign) {
      cid = 3 + (midAssign[i] || 0);
    } else if (i in defAssign) {
      cid = 5 + (defAssign[i] || 0);
    } else {
      // fallback by attribute heuristic
      const row = Z[i];
      const atk = (row[attrIndex("SHO")] || 0) + (row[attrIndex("DRI")] || 0) + (row[attrIndex("PAC")] || 0);
      const mid = (row[attrIndex("PAS")] || 0) + (row[attrIndex("DRI")] || 0);
      const def = (row[attrIndex("DEF")] || 0) + (row[attrIndex("Standing Tackle")] || 0) + (row[attrIndex("Interceptions")] || 0);
      if (atk >= mid && atk >= def) cid = 1;
      else if (mid >= atk && mid >= def) cid = 3;
      else cid = 5;
    }
    p.clusterId = cid;
    p.clusterLabel = CLUSTER_LABELS[cid] || `C${cid + 1}`;
  });

  // Build clusterMeta for UI using requested static labels + colors
  clusterMeta = [];
  for (let i = 0; i < 7; i++) {
    clusterMeta.push({ index: i, color: CLUSTER_COLORS[i], label: CLUSTER_LABELS[i] || `C${i + 1}` });
  }

  clustersComputed = true;
  return players;
}

/**************************************************************
 * INIT
 **************************************************************/
document.addEventListener("DOMContentLoaded", () => {
  setupGenderToggle();
  setupResetButton();
  setupTableToggle();
  setupPlayerFinderControls();
  setupLeagueTabs();
  drawWorldMap();
});

/**************************************************************
 * FILTER HELPERS
 **************************************************************/
function getGenderFilteredPlayers() {
  if (currentGender === "ALL") return allPlayers;
  return allPlayers.filter(d => d.GENDER === currentGender);
}

function getFilteredPlayers() {
  const base = getGenderFilteredPlayers();
  if (!currentCountry) return base;

  // Normalise names to improve matching between GeoJSON feature names
  // and player `Nation` values (handles small differences/diacritics).
  function normalizeName(s) {
    if (!s) return "";
    return String(s)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
  }

  const normC = normalizeName(currentCountry);

  // Exact normalised match first
  const exact = base.filter(d => normalizeName(d.Nation) === normC);
  if (exact.length) return exact;

  // Fallback to partial matches (e.g., 'unitedstates' vs 'unitedstatesofamerica')
  const partial = base.filter(d => {
    const n = normalizeName(d.Nation);
    return n.includes(normC) || normC.includes(n);
  });
  if (partial.length) return partial;

  // Last resort: strict equality
  return base.filter(d => d.Nation === currentCountry);
}

/**************************************************************
 * TOGGLES
 **************************************************************/
function setupGenderToggle() {
  const buttons = document.querySelectorAll(".gender-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      currentGender = btn.dataset.gender;
      currentCountry = null;
      brushedPlayers = null;
      currentClusterSelection = null;

      d3.selectAll("path.country").classed("selected", false);

      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      refreshAllVisuals();
    });
  });
}

function setupResetButton() {
  const btn = document.getElementById('reset-filters-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    currentGender = 'ALL';
    currentCountry = null;
    brushedPlayers = null;
    currentClusterSelection = null;
    activePlayer = null;
    activePlayerKey = null;

    // reset gender UI
    document.querySelectorAll('.gender-btn').forEach(b => b.classList.remove('active'));
    const allBtn = document.querySelector('.gender-btn[data-gender="ALL"]');
    if (allBtn) allBtn.classList.add('active');

    d3.selectAll('path.country').classed('selected', false).attr('stroke', '#222').attr('stroke-width', 0.4);
    refreshAllVisuals();
  });
}

function setupTableToggle() {
  const buttons = document.querySelectorAll(".table-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      tableMode = btn.dataset.mode;
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      updateTopTable();
    });
  });
}

function setupLeagueTabs() {
  const buttons = document.querySelectorAll(".combined-tab");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      leagueViewMode = btn.dataset.mode;
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      updateCombinedLeagueVisibility();
    });
  });
}

/**************************************************************
 * PLAYER FINDER CONTROLS
 **************************************************************/
function setupPlayerFinderControls() {
  const minInput = document.getElementById("ovr-min");
  const maxInput = document.getElementById("ovr-max");
  const roleSelect = document.getElementById("role-select");
  const clusterSelect = document.getElementById("cluster-filter-select");
  const btn = document.getElementById("finder-search-btn");

  // Add a name search input (dynamically) to the finder controls if not present
  let nameInput = document.getElementById('finder-name-input');
  if (!nameInput) {
    const finderControls = document.querySelector('#player-finder .finder-controls');
    if (finderControls) {
      const div = document.createElement('div');
      div.className = 'finder-row';
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.gap = '6px';

      const input = document.createElement('input');
      input.id = 'finder-name-input';
      input.placeholder = 'Search name...';
      input.style.padding = '4px';
      input.style.background = '#26262b';
      input.style.border = '1px solid #4b5563';
      input.style.color = '#e5e7eb';
      input.style.borderRadius = '6px';
      input.style.minWidth = '120px';

      div.appendChild(input);
      finderControls.insertBefore(div, finderControls.firstChild);

      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { finderCriteria.name = input.value.trim(); runPlayerFinder(); } });
    }
  }

  btn.addEventListener("click", () => {
    const minVal = parseInt(minInput.value) || 40;
    const maxVal = parseInt(maxInput.value) || 99;
    finderCriteria.min = Math.max(40, Math.min(99, minVal));
    finderCriteria.max = Math.max(40, Math.min(99, maxVal));
    finderCriteria.role = roleSelect.value;
    finderCriteria.cluster = clusterSelect.value;
    // read name input (if any) and use it for the search
    finderCriteria.name = (document.getElementById('finder-name-input')?.value || '').trim();
    runPlayerFinder();
  });
}

/**************************************************************
 * WORLD MAP
 **************************************************************/
function drawWorldMap() {
  const container = document.getElementById("world-map");
  const bounds = container.getBoundingClientRect();
  const width = 450;
  const height = 250;

  const svg = d3.select("#world-map")
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .style("border-radius", "8px")
    .attr("class", "fade-in");

  const defs = svg.append('defs');
  
  // Add patterns for each density level
  const mapPatterns = [
    { id: 'map-zero', color: zeroColor, type: 'solid' },
    { id: 'map-1', color: greenBins[0].color, type: 'dots-sparse' },
    { id: 'map-2', color: greenBins[1].color, type: 'dots-medium' },
    { id: 'map-3', color: greenBins[2].color, type: 'diagonal-light' },
    { id: 'map-4', color: greenBins[3].color, type: 'diagonal-dense' },
    { id: 'map-5', color: greenBins[4].color, type: 'crosshatch' },
    { id: 'map-6', color: greenBins[5].color, type: 'solid-dark' }
  ];
  
  mapPatterns.forEach(p => {
    const pattern = defs.append('pattern')
      .attr('id', p.id)
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 6)
      .attr('height', 6);
    
    pattern.append('rect').attr('width', 6).attr('height', 6).attr('fill', p.color);
    
    if (p.type === 'dots-sparse') {
      pattern.append('circle').attr('cx', 3).attr('cy', 3).attr('r', 0.8)
        .attr('fill', 'rgba(0,0,0,0.2)');
    } else if (p.type === 'dots-medium') {
      pattern.append('circle').attr('cx', 2).attr('cy', 2).attr('r', 1)
        .attr('fill', 'rgba(0,0,0,0.25)');
      pattern.append('circle').attr('cx', 5).attr('cy', 5).attr('r', 1)
        .attr('fill', 'rgba(0,0,0,0.25)');
    } else if (p.type === 'diagonal-light') {
      pattern.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 6).attr('y2', 6)
        .attr('stroke', 'rgba(0,0,0,0.2)').attr('stroke-width', 1);
    } else if (p.type === 'diagonal-dense') {
      pattern.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 6).attr('y2', 6)
        .attr('stroke', 'rgba(0,0,0,0.3)').attr('stroke-width', 1.2);
      pattern.append('line').attr('x1', 0).attr('y1', 6).attr('x2', 6).attr('y2', 0)
        .attr('stroke', 'rgba(0,0,0,0.15)').attr('stroke-width', 0.8);
    } else if (p.type === 'crosshatch') {
      pattern.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 6).attr('y2', 6)
        .attr('stroke', 'rgba(0,0,0,0.35)').attr('stroke-width', 1.2);
      pattern.append('line').attr('x1', 0).attr('y1', 6).attr('x2', 6).attr('y2', 0)
        .attr('stroke', 'rgba(0,0,0,0.35)').attr('stroke-width', 1.2);
    }
  });

  const g = svg.append("g").attr("transform", "translate(5,5)");

  const projection = d3.geoMercator()
    .scale(width / 7)
    .translate([width / 2, height / 1.6]);

  const path = d3.geoPath().projection(projection);

  Promise.all([
    d3.json("data/world_countries.json"),
    d3.csv("data/players_26.csv", d3.autoType)
  ]).then(([world, players]) => {
    worldGeo = world;
    allPlayers = players;
    if (!clustersComputed) allPlayers = computeClusters(allPlayers);

    g.selectAll("path.country")
      .data(world.features)
      .enter()
      .append("path")
      .attr("class", "country")
      .attr("d", path)
      .attr("stroke", "#222")
      .attr("stroke-width", 0.4)
      .attr("fill", zeroColor)
      .attr("opacity", 0.95)
      .on("mouseover", function (event, d) {
        const name = d.properties.name;
        const count = currentCountsMap.get(name) || 0;
        tooltip.style("opacity", 1).html(`
          <strong>${name}</strong><br>
          Players: ${count}
        `);
        d3.select(this).attr("stroke", "black").attr("stroke-width", 1.2);
      })
      .on("mousemove", event => {
        tooltip.style("left", event.pageX + 12 + "px")
               .style("top", event.pageY - 28 + "px");
      })
      .on("mouseout", function () {
        tooltip.style("opacity", 0);
        const sel = d3.select(this).classed("selected");
        d3.select(this)
          .attr("stroke", sel ? "#fff" : "#222")
          .attr("stroke-width", sel ? 1.5 : 0.4);
      })
      .on("click", function (event, d) {
        const name = d.properties.name;
        brushedPlayers = null;
        currentClusterSelection = null;
        if (currentCountry === name) {
          currentCountry = null;
          d3.selectAll("path.country").classed("selected", false)
            .attr("stroke", "#222").attr("stroke-width", 0.4);
        } else {
          currentCountry = name;
          d3.selectAll("path.country").classed("selected", false)
            .attr("stroke", "#222").attr("stroke-width", 0.4);
          d3.select(this)
            .classed("selected", true)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5);
        }
        refreshAllVisuals();
      });

    buildLegend();
    refreshAllVisuals();
  });
}

/**************************************************************
 * MAP COLOURS
 **************************************************************/
function updateMapColours() {
  const filtered = getGenderFilteredPlayers();

  currentCountsMap = d3.rollup(
    filtered,
    v => v.length,
    d => d.Nation
  );

  d3.selectAll("path.country")
    .transition().duration(400)
    .attr("fill", d => {
      const name = d.properties.name;
      const count = currentCountsMap.get(name) || 0;
      return getCountryPattern(count);
    });
}

/**************************************************************
 * MAP LEGEND
 **************************************************************/
function buildLegend() {
  const legend = d3.select("#world-legend");
  legend.selectAll("*").remove();

  const items = [
    { label: "0", pattern: 'map-zero' },
    { label: "1–250",     pattern: 'map-1' },
    { label: "251–500",   pattern: 'map-2' },
    { label: "501–750",   pattern: 'map-3' },
    { label: "751–1000",  pattern: 'map-4' },
    { label: "1001–1250", pattern: 'map-5' },
    { label: "1251+",     pattern: 'map-6' }
  ];

  items.forEach(item => {
    const entry = legend.append("div").attr("class", "legend-item");
    const svg = entry.append("svg")
      .attr("class", "legend-color-box")
      .attr("width", 16)
      .attr("height", 16);
    svg.append("rect")
      .attr("width", 16)
      .attr("height", 16)
      .attr("fill", `url(#${item.pattern})`);
    entry.append("span").text(item.label);
  });
}

/**************************************************************
 * TOP 10 TABLE  (Countries / Clubs / Players)
 **************************************************************/
function updateTopTable() {
  let filtered = getFilteredPlayers();
  if (!filtered.length) return;

  if (currentClusterSelection != null) {
    filtered = filtered.filter(p => p.clusterId === currentClusterSelection);
    if (!filtered.length) return;
  }

  const tbody = d3.select("#top-table tbody");
  tbody.selectAll("tr").remove();

  // MODE 1: TOP COUNTRIES
  if (tableMode === "country") {
    const grouped = d3.group(filtered, d => d.Nation);
    const summaries = [];

    for (const [nation, players] of grouped) {
      if (!nation) continue;

      const sorted = players.slice().sort((a, b) => b.OVR - a.OVR);
      const top25 = sorted.slice(0, 25);
      if (top25.length < 5) continue;

      summaries.push({
        name: nation,
        avg: d3.mean(top25, d => d.OVR)
      });
    }

    const top10 = summaries.sort((a, b) => b.avg - a.avg).slice(0, 10);

    const rows = tbody.selectAll("tr").data(top10).enter().append("tr");
    rows.append("td").text((d, i) => i + 1);
    rows.append("td").text(d => d.name);
    rows.append("td").text(d => d.avg.toFixed(2));
    return;
  }

  // MODE 2: TOP CLUBS
  if (tableMode === "club") {
    const grouped = d3.group(filtered, d => d.Team);
    const summaries = [];

    for (const [club, players] of grouped) {
      if (!club) continue;

      const sorted = players.slice().sort((a, b) => b.OVR - a.OVR);
      const top25 = sorted.slice(0, 25);
      if (top25.length < 5) continue;

      summaries.push({
        name: club,
        avg: d3.mean(top25, d => d.OVR)
      });
    }

    const top10 = summaries.sort((a, b) => b.avg - a.avg).slice(0, 10);

    const rows = tbody.selectAll("tr").data(top10).enter().append("tr");
    rows.append("td").text((d, i) => i + 1);
    rows.append("td").text(d => d.name);
    rows.append("td").text(d => d.avg.toFixed(2));
    return;
  }

  // MODE 3: TOP PLAYERS
  if (tableMode === "players") {
    const sorted = filtered.slice().sort((a, b) => b.OVR - a.OVR).slice(0, 10);

    const rows = tbody.selectAll("tr").data(sorted).enter().append("tr");
    rows.append("td").text((d, i) => i + 1);
    rows.append("td").text(d => d.Name);
    rows.append("td").text(d => d.OVR);
  }

  // MODE 4: TOP LEAGUES
  if (tableMode === "leagues") {
    const grouped = d3.group(filtered, d => d.League);
    const summaries = [];

    for (const [league, players] of grouped) {
      if (!league) continue;

      const sorted = players.slice().sort((a, b) => b.OVR - a.OVR);
      const top70 = sorted.slice(0, 70);
      if (top70.length < 5) continue;

      summaries.push({
        name: league,
        avg: d3.mean(top70, d => d.OVR)
      });
    }

    const top10 = summaries.sort((a, b) => b.avg - a.avg).slice(0, 10);

    const rows = tbody.selectAll("tr").data(top10).enter().append("tr");
    rows.append("td").text((d, i) => i + 1);
    rows.append("td").text(d => d.name);
    rows.append("td").text(d => d.avg.toFixed(2));
    return;
  }
}

/**************************************************************
 * REFRESH ALL VISUALS
 **************************************************************/
function refreshAllVisuals() {
  if (!allPlayers.length || !worldGeo) return;
  updateMapColours();
  updateTopTable();
  drawScatterPlot();
  drawClusterRadial();
  updateSelectionSummary();
  runPlayerFinder();
  drawCombinedLeagueView();
  drawSquadComposition();
  if (typeof drawAttributeRadial === 'function') drawAttributeRadial();
}



/**************************************************************
 * SCATTER (green theme, 0–100 axes, ticks = 10, with brushing)
 **************************************************************/
function drawScatterPlot() {
  const container = d3.select("#scatter-physical-technical");
  container.selectAll("*").remove();

  const players = getFilteredPlayers();
  if (!players.length) return;

  players.forEach(p => {
    p.tech = (p.PAS + p.DRI + p.SHO) / 3;
    p.phys = (p.PHY + p.Strength + (p.Aggression || 0)) / 3;
  });

  const width = (container.node().clientWidth || 320) - 10;
  const height = 220;

  const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("class", "fade-in");

  const x = d3.scaleLinear().domain([20, 90]).range([40, width - 10]);
  const y = d3.scaleLinear().domain([20, 90]).range([height - 30, 15]);

  svg.append("g")
    .attr("transform", `translate(0, ${height - 30})`)
    .call(d3.axisBottom(x).tickValues(d3.range(20, 91, 10)))
    .selectAll("text").style("fill", "#ccc").style("font-size", "10px");

  svg.append("g")
    .attr("transform", `translate(40, 0)`)
    .call(d3.axisLeft(y).tickValues(d3.range(20, 91, 10)))
    .selectAll("text").style("fill", "#ccc").style("font-size", "10px");

  svg.append("text")
    .attr("x", width / 2)
    .attr("y", height - 5)
    .attr("text-anchor", "middle")
    .attr("fill", "#ccc")
    .attr("font-size", "11px")
    .text("Technical Skill");

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", 12)
    .attr("text-anchor", "middle")
    .attr("fill", "#ccc")
    .attr("font-size", "11px")
    .text("Physicality");

  // Draw shapes based on cluster
  players.forEach(d => {
    const baseSize = (currentClusterSelection == null || d.clusterId === currentClusterSelection) ? 3.5 : 2.5;
    const shape = getClusterShape(d.clusterId || 0, x(d.tech), y(d.phys), baseSize);
    const fill = d.clusterId != null ? CLUSTER_COLORS[d.clusterId] : "#43f1e5ff";
    const opacity = currentClusterSelection == null ? 0.7 : (d.clusterId === currentClusterSelection ? 0.95 : 0.12);

    let element;
    if (shape.type === 'circle') {
      element = svg.append('circle')
        .attr('cx', shape.cx)
        .attr('cy', shape.cy)
        .attr('r', shape.r);
    } else if (shape.type === 'rect') {
      element = svg.append('rect')
        .attr('x', shape.x)
        .attr('y', shape.y)
        .attr('width', shape.width)
        .attr('height', shape.height);
    } else if (shape.type === 'path') {
      element = svg.append('path')
        .attr('d', shape.d);
    }

    element
      .attr('fill', fill)
      .attr('opacity', opacity)
      .on('mouseover', function (event) {
        tooltip.style('opacity', 1).html(`
          <strong>${d.Name}</strong><br>
          Tech: ${d.tech.toFixed(1)}<br>
          Phys: ${d.phys.toFixed(1)}
        `);
        const hoverShape = getClusterShape(d.clusterId || 0, x(d.tech), y(d.phys), 6);
        if (hoverShape.type === 'circle') {
          d3.select(this).attr('r', hoverShape.r);
        } else if (hoverShape.type === 'rect') {
          d3.select(this).attr('x', hoverShape.x).attr('y', hoverShape.y)
            .attr('width', hoverShape.width).attr('height', hoverShape.height);
        } else if (hoverShape.type === 'path') {
          d3.select(this).attr('d', hoverShape.d);
        }
        d3.select(this).attr('opacity', 1);
      })
      .on('mousemove', event => {
        tooltip.style('left', event.pageX + 12 + 'px')
               .style('top', event.pageY - 28 + 'px');
      })
      .on('mouseout', function () {
        tooltip.style('opacity', 0);
        const restoreShape = getClusterShape(d.clusterId || 0, x(d.tech), y(d.phys), baseSize);
        if (restoreShape.type === 'circle') {
          d3.select(this).attr('r', restoreShape.r);
        } else if (restoreShape.type === 'rect') {
          d3.select(this).attr('x', restoreShape.x).attr('y', restoreShape.y)
            .attr('width', restoreShape.width).attr('height', restoreShape.height);
        } else if (restoreShape.type === 'path') {
          d3.select(this).attr('d', restoreShape.d);
        }
        d3.select(this).attr('opacity', opacity);
      });
  });

  // Brush for selection summary
  const brush = d3.brush()
    .extent([[40, 15], [width - 10, height - 30]])
    .on("end", (event) => {
      if (!event.selection) {
        brushedPlayers = null;
      } else {
        const [[x0, y0], [x1, y1]] = event.selection;
        const selected = players.filter(p => {
          const px = x(p.tech);
          const py = y(p.phys);
          return x0 <= px && px <= x1 && y0 <= py && py <= y1;
        });
        brushedPlayers = selected.length ? selected : null;
      }
      updateSelectionSummary();
    });

  svg.append("g")
    .attr("class", "brush")
    .call(brush);
}

/**************************************************************
 * LEAGUE STRENGTH (amber theme) + TALENT FLOWS (bipartite)
 * Combined in Cell 8 with tabs
 **************************************************************/
function drawCombinedLeagueView() {
  // Draw both; visibility is controlled by CSS toggling.
  drawLeagueStrengthChart();
  drawLeagueNationGraph();
  updateCombinedLeagueVisibility();
}

function updateCombinedLeagueVisibility() {
  const ls = document.getElementById("league-strength");
  const ln = document.getElementById("league-nation-graph");
  if (!ls || !ln) return;

  if (leagueViewMode === "league-strength") {
    ls.style.display = "flex";
    ln.style.display = "none";
  } else {
    ls.style.display = "none";
    ln.style.display = "flex"; // for bipartite chart, flex works fine
  }
}

function drawLeagueStrengthChart() {
  const container = d3.select("#league-strength");
  container.selectAll("*").remove();
  let players = getFilteredPlayers();
  if (currentClusterSelection != null) players = players.filter(p => p.clusterId === currentClusterSelection);
  if (!players.length) return;

  const grouped = d3.group(players, d => d.League);
  const summaries = [];

  for (const [league, list] of grouped) {
    if (!league) continue;
    const sorted = list.slice().sort((a, b) => b.OVR - a.OVR);
    const top25 = sorted.slice(0, 25);
    if (top25.length < 25) continue;
    summaries.push({
      league,
      avg: d3.mean(top25, d => d.OVR)
    });
  }

  summaries.sort((a, b) => b.avg - a.avg);
  const top5 = summaries.slice(0, 5);
  if (!top5.length) return;

  const width = 550;
  const height = 220;

  const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("class", "fade-in");

  const y = d3.scaleBand()
    .domain(top5.map(d => d.league))
    .range([20, 200])
    .padding(0.2);

  const x = d3.scaleLinear()
    .domain([60, d3.max(top5, d => d.avg)])
    .range([120, 400]);

  svg.append("g")
    .attr("transform", "translate(120,0)")
    .call(d3.axisLeft(y))
    .selectAll("text").style("fill", "#ccc").style("font-size", "10px");

  svg.selectAll("rect")
    .data(top5)
    .enter()
    .append("rect")
    .attr("x", 120)
    .attr("y", d => y(d.league))
    .attr("height", y.bandwidth())
    .attr("width", 0)
    .attr("fill", "#087a0a7c")
    .transition()
    .duration(500)
    .attr("width", d => x(d.avg) - 120);

  svg.selectAll(".label")
    .data(top5)
    .enter()
    .append("text")
    .attr("x", d => x(d.avg) + 2)
    .attr("y", d => y(d.league) + y.bandwidth() / 1.6)
    .attr("fill", "#fef9c3")
    .attr("font-size", "11px")
    .text(d => d.avg.toFixed(1));
}

function drawLeagueNationGraph() {
  const container = d3.select("#league-nation-graph");
  container.selectAll("*").remove();
  let players = getFilteredPlayers();
  if (currentClusterSelection != null) players = players.filter(p => p.clusterId === currentClusterSelection);
  if (!players.length) return;

  const nationCounts = d3.rollups(players, v => v.length, d => d.Nation)
    .filter(([n]) => n)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const leagueCounts = d3.rollups(players, v => v.length, d => d.League)
    .filter(([l]) => l)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const topNations = new Set(nationCounts.map(d => d[0]));
  const topLeagues = new Set(leagueCounts.map(d => d[0]));

  const edgesMap = new Map();
  players.forEach(p => {
    if (!topNations.has(p.Nation) || !topLeagues.has(p.League)) return;
    const key = p.Nation + "||" + p.League;
    edgesMap.set(key, (edgesMap.get(key) || 0) + 1);
  });

  const edges = Array.from(edgesMap, ([key, count]) => {
    const [nation, league] = key.split("||");
    return { nation, league, count };
  }).sort((a, b) => b.count - a.count);

  if (!edges.length) return;

  const width = 400;
  const height = 270;

  const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("class", "fade-in");

  const leftX = 80;
  const rightX = width - 110;

  const nationScale = d3.scalePoint()
    .domain(nationCounts.map(d => d[0]))
    .range([30, height - 40]);

  const leagueScale = d3.scalePoint()
    .domain(leagueCounts.map(d => d[0]))
    .range([30, height - 40]);

  const edgeWidth = d3.scaleLinear()
    .domain([1, d3.max(edges, d => d.count)])
    .range([1, 6]);

  // Edges
  svg.selectAll("path.edge")
    .data(edges)
    .enter()
    .append("path")
    .attr("class", "edge")
    .attr("d", d => {
      const y1 = nationScale(d.nation);
      const y2 = leagueScale(d.league);
      const mx = (leftX + rightX) / 2;
      return `M${leftX},${y1} C${mx},${y1} ${mx},${y2} ${rightX},${y2}`;
    })
    .attr("fill", "none")
    .attr("stroke", "#4b5563")
    .attr("stroke-width", d => edgeWidth(d.count))
    .attr("stroke-opacity", 0.45)
    .on("mouseover", function (event, d) {
      tooltip.style("opacity", 1).html(`
        <strong>${d.nation} → ${d.league}</strong><br>
        Players: ${d.count}
      `);
      d3.select(this).attr("stroke-opacity", 0.9).attr("stroke", "#facc15");
    })
    .on("mousemove", event => {
      tooltip.style("left", event.pageX + 12 + "px")
             .style("top", event.pageY - 28 + "px");
    })
    .on("mouseout", function () {
      tooltip.style("opacity", 0);
      d3.select(this).attr("stroke-opacity", 0.45).attr("stroke", "#4b5563");
    });

  // Nation nodes
  svg.selectAll("circle.nation")
    .data(nationCounts)
    .enter()
    .append("circle")
    .attr("class", "nation")
    .attr("cx", leftX)
    .attr("cy", d => nationScale(d[0]))
    .attr("r", 6)
    .attr("fill", "#38bdf8");

  svg.selectAll("text.nation-label")
    .data(nationCounts)
    .enter()
    .append("text")
    .attr("class", "nation-label")
    .attr("x", leftX - 10)
    .attr("y", d => nationScale(d[0]))
    .attr("text-anchor", "end")
    .attr("dominant-baseline", "middle")
    .attr("fill", "#e5e7eb")
    .attr("font-size", "10px")
    .text(d => d[0]);

  // League nodes
  svg.selectAll("circle.league")
    .data(leagueCounts)
    .enter()
    .append("circle")
    .attr("class", "league")
    .attr("cx", rightX)
    .attr("cy", d => leagueScale(d[0]))
    .attr("r", 6)
    .attr("fill", "#fb923c");

  svg.selectAll("text.league-label")
    .data(leagueCounts)
    .enter()
    .append("text")
    .attr("class", "league-label")
    .attr("x", rightX + 10)
    .attr("y", d => leagueScale(d[0]))
    .attr("text-anchor", "start")
    .attr("dominant-baseline", "middle")
    .attr("fill", "#e5e7eb")
    .attr("font-size", "10px")
    .text(d => d[0]);
}

/**************************************************************
 * PCA + K-MEANS + RADIAL CLUSTER VIEW (cell 1)
 **************************************************************/
function drawClusterRadial() {
  const container = d3.select("#cluster-radial");
  container.selectAll("*").remove();

  const attrs = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY", "OVR"];
  const players = getFilteredPlayers().filter(p =>
    attrs.every(a => typeof p[a] === "number")
  );
  if (players.length < 20) return;

  const n = players.length;
  const d = attrs.length;
  const X = players.map(p => attrs.map(a => p[a]));

  // Center columns
  const means = new Array(d).fill(0);
  for (let j = 0; j < d; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += X[i][j];
    means[j] = sum / n;
    for (let i = 0; i < n; i++) X[i][j] -= means[j];
  }

  // Covariance matrix C = (1/(n-1)) X^T X
  const C = Array.from({ length: d }, () => new Array(d).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      for (let k = 0; k < d; k++) {
        C[j][k] += X[i][j] * X[i][k];
      }
    }
  }
  for (let j = 0; j < d; j++) {
    for (let k = 0; k < d; k++) C[j][k] /= (n - 1);
  }

  function powerIteration(A, iterations = 40) {
    const m = A.length;
    let v = Array.from({ length: m }, () => Math.random());
    for (let it = 0; it < iterations; it++) {
      const Av = new Array(m).fill(0);
      for (let i = 0; i < m; i++) {
        for (let j = 0; j < m; j++) Av[i] += A[i][j] * v[j];
      }
      const norm = Math.sqrt(Av.reduce((s, x) => s + x * x, 0));
      for (let i = 0; i < m; i++) v[i] = Av[i] / (norm || 1);
    }
    const Av = new Array(m).fill(0);
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) Av[i] += A[i][j] * v[j];
    }
    const lambda = v.reduce((s, x, i) => s + x * Av[i], 0);
    return { v, lambda };
  }

  const { v: pc1, lambda: lambda1 } = powerIteration(C, 50);
  const C2 = Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) => C[i][j] - lambda1 * pc1[i] * pc1[j])
  );
  const { v: pc2 } = powerIteration(C2, 50);

  const projected = players.map((p, idx) => {
    const row = X[idx];
    let s1 = 0, s2 = 0;
    for (let j = 0; j < d; j++) {
      s1 += row[j] * pc1[j];
      s2 += row[j] * pc2[j];
    }
    return { player: p, pc1: s1, pc2: s2, mag: Math.hypot(s1, s2), cluster: p.clusterId || 0 };
  });

  // Use precomputed clusters (7 total: 0 = GK, 1-6 outfield)
  const k = 7;
  const colors = CLUSTER_COLORS;

  // Compute magnitudes per cluster for radial scaling
  const maxMag = d3.max(projected, p => p.mag) || 1;
  const clusterStats = Array.from({ length: k }, () => ({ maxMag: 0 }));
  projected.forEach(p => {
    const c = p.cluster;
    clusterStats[c].maxMag = Math.max(clusterStats[c].maxMag, p.mag);
  });

  // Create flex container with viz on left, legend on right
  const wrapper = container.append("div")
    .style("display", "flex")
    .style("align-items", "flex-start")
    .style("gap", "16px");

  const vizContainer = wrapper.append("div")
    .style("flex", "1")
    .style("min-width", "0");

  const legendContainer = wrapper.append("div")
    .style("flex-shrink", "0")
    .style("width", "140px");

  const containerWidth = container.node().clientWidth || 320;
  const width = Math.max(250, containerWidth - 160); // leave room for legend
  const height = 280;

  const svg = vizContainer.append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("class", "fade-in");

  const cx = width / 2;
  const cy = height / 2;
  const outerR = Math.min(width, height) / 2 - 30; // more padding to keep labels in frame
  const innerR = 12;

  projected.forEach(p => {
    const c = p.cluster;
    const angleBase = (2 * Math.PI * c) / k;
    const jitter = (Math.random() - 0.5) * (Math.PI / 20);
    const norm = maxMag > 0 ? p.mag / maxMag : 0.3;
    const r = innerR + (outerR - innerR) * norm;
    const angle = angleBase + jitter;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);

    const opac = currentClusterSelection == null ? 0.85 : (currentClusterSelection === c ? 0.95 : 0.12);

    // Get shape based on cluster
    const baseSize = 4;
    const shape = getClusterShape(c, x, y, baseSize);
    
    let element;
    if (shape.type === 'circle') {
      element = svg.append('circle')
        .attr('cx', shape.cx)
        .attr('cy', shape.cy)
        .attr('r', shape.r);
    } else if (shape.type === 'rect') {
      element = svg.append('rect')
        .attr('x', shape.x)
        .attr('y', shape.y)
        .attr('width', shape.width)
        .attr('height', shape.height);
    } else if (shape.type === 'path') {
      element = svg.append('path')
        .attr('d', shape.d);
    }

    element
      .attr('fill', colors[c])
      .attr('opacity', opac);

    // highlight if matches activePlayerKey
    const thisKey = playerKey(p.player);
    if (activePlayerKey && thisKey === activePlayerKey) {
      const highlightShape = getClusterShape(c, x, y, 6.5);
      if (highlightShape.type === 'circle') {
        element.attr('r', highlightShape.r);
      } else if (highlightShape.type === 'rect') {
        element.attr('x', highlightShape.x).attr('y', highlightShape.y)
          .attr('width', highlightShape.width).attr('height', highlightShape.height);
      } else if (highlightShape.type === 'path') {
        element.attr('d', highlightShape.d);
      }
      element.attr('stroke', '#ffffff').attr('stroke-width', 1.4).attr('opacity', 1);
    }

    element.on("mouseover", function (event) {
        const pl = p.player;
        tooltip.style("opacity", 1).html(`\n          <strong>${pl.Name}</strong><br>\n          ${pl.clusterLabel || ''}<br>\n          Pos: ${pl.Position} | OVR: ${pl.OVR}\n        `);
        const hoverShape = getClusterShape(c, x, y, 6);
        if (hoverShape.type === 'circle') {
          d3.select(this).attr('r', hoverShape.r);
        } else if (hoverShape.type === 'rect') {
          d3.select(this).attr('x', hoverShape.x).attr('y', hoverShape.y)
            .attr('width', hoverShape.width).attr('height', hoverShape.height);
        } else if (hoverShape.type === 'path') {
          d3.select(this).attr('d', hoverShape.d);
        }
        d3.select(this).attr("opacity", 1);
      })
      .on("mousemove", event => {
        tooltip.style("left", event.pageX + 12 + "px")
               .style("top", event.pageY - 28 + "px");
      })
      .on("mouseout", function () {
        tooltip.style("opacity", 0);
        // restore size/opacity (account for active highlight)
        const restoreSize = (activePlayerKey && thisKey === activePlayerKey) ? 6.5 : 4;
        const restoreShape = getClusterShape(c, x, y, restoreSize);
        if (restoreShape.type === 'circle') {
          d3.select(this).attr('r', restoreShape.r);
        } else if (restoreShape.type === 'rect') {
          d3.select(this).attr('x', restoreShape.x).attr('y', restoreShape.y)
            .attr('width', restoreShape.width).attr('height', restoreShape.height);
        } else if (restoreShape.type === 'path') {
          d3.select(this).attr('d', restoreShape.d);
        }
        const restoreOp = (currentClusterSelection == null ? 0.85 : (currentClusterSelection === c ? 0.95 : 0.12));
        d3.select(this).attr("opacity", restoreOp);
      })
      .on('click', (event) => {
        // select this player as active for Tile 9
        setActivePlayer(p.player);
      });
  });

  // Spokes & labels
  for (let c = 0; c < k; c++) {
    const angle = (2 * Math.PI * c) / k;
    const xOuter = cx + (outerR + 4) * Math.cos(angle);
    const yOuter = cy + (outerR + 4) * Math.sin(angle);

    svg.append("line")
      .attr("x1", cx)
      .attr("y1", cy)
      .attr("x2", xOuter)
      .attr("y2", yOuter)
      .attr("stroke", "#334155")
      .attr("stroke-dasharray", "3,3");

    const labelR = outerR + 24;
    let lx = cx + labelR * Math.cos(angle);
    const ly = cy + labelR * Math.sin(angle);
    if (c === 1) lx += 20; // shift C1 right to avoid overlap

    svg.append("text")
      .attr("x", lx)
      .attr("y", ly)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", colors[c])
      .attr("font-size", "10px")
      .text(`C${c + 1}: ${CLUSTER_LABELS[c] || 'C'+(c+1)}`);
  }

  // Build cluster meta from precomputed labels/colors
  clusterMeta = [];
  for (let i = 0; i < k; i++) clusterMeta.push({ index: i, color: colors[i], label: CLUSTER_LABELS[i] || `C${i}` });
  renderClusterLegend(legendContainer);
  populateClusterFilterSelect();
}

function renderClusterLegend(container) {
  const targetContainer = container || d3.select("#cluster-radial");
  const legend = targetContainer.append("div")
    .attr("class", "cluster-legend");

  const items = legend.selectAll(".cluster-legend-item")
    .data(clusterMeta)
    .enter()
    .append("div")
    .attr("class", d =>
      "cluster-legend-item" +
      (currentClusterSelection === d.index ? " active" : "")
    )
    .on("click", (event, d) => {
      if (currentClusterSelection === d.index) {
        currentClusterSelection = null;
      } else {
        currentClusterSelection = d.index;
      }
      // Re-render entire visualization to update active state
      drawClusterRadial();
      // Also sync dropdown & player finder
      const select = document.getElementById("cluster-filter-select");
      if (select) {
        select.value = currentClusterSelection == null ? "any" : String(currentClusterSelection);
      }
      runPlayerFinder();
      updateSelectionSummary();
      refreshAllVisuals();
    });

  // Add SVG with shape instead of colored square
  items.each(function(d) {
    const item = d3.select(this);
    
    const svg = item.append("svg")
      .attr("class", "cluster-legend-color")
      .attr("width", 16)
      .attr("height", 16);
    
    const shape = getClusterShape(d.index, 8, 8, 3.5);
    
    if (shape.type === 'circle') {
      svg.append('circle')
        .attr('cx', shape.cx)
        .attr('cy', shape.cy)
        .attr('r', shape.r)
        .attr('fill', d.color);
    } else if (shape.type === 'rect') {
      svg.append('rect')
        .attr('x', shape.x)
        .attr('y', shape.y)
        .attr('width', shape.width)
        .attr('height', shape.height)
        .attr('fill', d.color);
    } else if (shape.type === 'path') {
      svg.append('path')
        .attr('d', shape.d)
        .attr('fill', d.color);
    }
    
    item.append("div")
      .attr("class", "cluster-legend-label")
      .text(`C${d.index + 1}: ${d.label}`);
  });
}

function populateClusterFilterSelect() {
  const select = document.getElementById("cluster-filter-select");
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = "";

  const optAny = document.createElement("option");
  optAny.value = "any";
  optAny.textContent = "Any cluster";
  select.appendChild(optAny);

  clusterMeta.forEach(cm => {
    const opt = document.createElement("option");
    opt.value = String(cm.index);
    opt.textContent = `C${cm.index + 1} – ${cm.label}`;
    select.appendChild(opt);
  });

  if (currentClusterSelection != null) {
    select.value = String(currentClusterSelection);
  } else {
    select.value = "any";
  }

  select.addEventListener("change", () => {
    const val = select.value;
    currentClusterSelection = val === "any" ? null : parseInt(val, 10);
    finderCriteria.cluster = val;
    runPlayerFinder();
    updateSelectionSummary();
    refreshAllVisuals();
  });
}

/**************************************************************
 * SELECTION SUMMARY CARD (cell 6)
 **************************************************************/
function updateSelectionSummary() {
  const container = d3.select("#selection-summary");
  container.selectAll("*").remove();

  let players = brushedPlayers && brushedPlayers.length
    ? brushedPlayers
    : getFilteredPlayers();

  // If a cluster is selected, limit summary to that cluster
  if (currentClusterSelection != null) {
    players = players.filter(p => p.clusterId === currentClusterSelection);
  }

  if (!players.length) {
    container.append("div").text("No players in current selection.");
    return;
  }

  players.forEach(p => {
    if (p.tech == null) {
      p.tech = (p.PAS + p.DRI + p.SHO) / 3;
    }
    if (p.phys == null) {
      p.phys = (p.PHY + p.Strength + (p.Aggression || 0)) / 3;
    }
  });

  const count = players.length;
  const avgOVR = d3.mean(players, d => d.OVR);
  const avgTech = d3.mean(players, d => d.tech);
  const avgPhys = d3.mean(players, d => d.phys);

  // Strongest / weakest attribute over main attribute set
  const attrs = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
  const attrMeans = attrs.map(a => ({
    attr: a,
    value: d3.mean(players, d => d[a])
  })).filter(d => d.value != null);

  let strongest = null;
  let weakest = null;
  if (attrMeans.length) {
    strongest = attrMeans.reduce((a, b) => a.value > b.value ? a : b);
    weakest = attrMeans.reduce((a, b) => a.value < b.value ? a : b);
  }

  const byNation = d3.rollups(players, v => v.length, d => d.Nation)
    .filter(([n]) => n)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const byPos = d3.rollups(players, v => v.length, d => d.Position)
    .filter(([p]) => p)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const header = container.append("div").attr("class", "summary-header");
  header.text(brushedPlayers ? `Brushed selection (${count} players)` :
    `All filtered players (${count} players)`);

  const grid = container.append("div").attr("class", "summary-grid");

  const tiles = [
    { label: "Players", value: count.toString() },
    { label: "Avg OVR", value: avgOVR.toFixed(1) },
    { label: "Avg Tech", value: avgTech.toFixed(1) },
    { label: "Avg Phys", value: avgPhys.toFixed(1) }
  ];

  if (strongest) {
    tiles.push({
      label: "Strongest Attr",
      value: `${strongest.attr}: ${strongest.value.toFixed(1)}`
    });
  }
  if (weakest) {
    tiles.push({
      label: "Weakest Attr",
      value: `${weakest.attr}: ${weakest.value.toFixed(1)}`
    });
  }

  tiles.forEach(t => {
    const tile = grid.append("div").attr("class", "summary-tile");
    tile.append("div").attr("class", "summary-label").text(t.label);
    tile.append("div").attr("class", "summary-value").text(t.value);
  });

  const listBlock = container.append("div").attr("class", "summary-list");

const natBlock = listBlock.append("div")
  .attr("class", "summary-inline");

natBlock.text(
  `Top Nations: ${byNation
    .map(([nation, c]) => `${nation} – ${c}`)
    .join(", ")}`
);






  // ============================================================
// Mini OVR histogram inside summary (enhanced)
// ============================================================
const chartDiv = container.append("div")
  .attr("class", "summary-mini-chart");

// Compute size from parent container so the chart uses available space
const parentW = (container.node().clientWidth || 320);
const parentH = (container.node().clientHeight || 200);
const miniW = Math.max(260, parentW - 10);
// Use a larger fraction of the parent height and cap sensibly so svg fills bottom space
const miniH = Math.max(110, Math.min(parentH - 30, Math.floor(parentH * 0.6)));
const margin = { top: 8, right: 10, bottom: 14, left: 50 };

const svg = chartDiv.append("svg")
  .attr("width", miniW)
  .attr("height", miniH)
  .style("max-width", "100%")
  .style("width", "100%")
  .attr("preserveAspectRatio", "none");

const g = svg.append("g")
  .attr("transform", `translate(${margin.left},${margin.top})`);

const width = miniW - margin.left - margin.right;
const height = miniH - margin.top - margin.bottom;

// Data
const ovrData = players.map(d => d.OVR);

// Scales
const x = d3.scaleLinear()
  .domain([40, 95])
  .range([0, width]);

const bins = d3.bin()
  .domain(x.domain())
  .thresholds(12)(ovrData);

const y = d3.scaleLinear()
  .domain([0, d3.max(bins, d => d.length)])
  .nice()
  .range([height, 0]);

// ============================================================
// AXES
// ============================================================
g.append("g")
  .attr("transform", `translate(0,${height})`)
  .call(d3.axisBottom(x).ticks(5))
  .attr("color", "#94a3b8")
  .selectAll("text")
  .attr("font-size", "9px");

g.append("g")
  .call(d3.axisLeft(y).ticks(3))
  .attr("color", "#94a3b8")
  .selectAll("text")
  .attr("font-size", "9px");

// Axis labels
g.append("text")
  .attr("x", width / 2)
  .attr("y", height + 25)
  .attr("text-anchor", "middle")
  .attr("fill", "#cbd5f5")
  .attr("font-size", "9px")
  .text("OVR");

g.append("text")
  .attr("transform", "rotate(-90)")
  .attr("x", -height/2)
  .attr("y", -40)
  .attr("text-anchor", "middle")
  .attr("fill", "#cbd5f5")
  .attr("font-size", "9px")
  .text("Players");

// ============================================================
// BARS
// ============================================================
g.selectAll("rect")
  .data(bins)
  .enter()
  .append("rect")
  .attr("x", d => x(d.x0))
  .attr("y", d => y(d.length))
  .attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - 1))
  .attr("height", d => height - y(d.length))
  .attr("fill", "#024c2eff")
  .attr("opacity", 0.85);

// ============================================================
// SMOOTH CURVE (distribution line)
// ============================================================
const line = d3.line()
  .curve(d3.curveCatmullRom)
  .x(d => x((d.x0 + d.x1) / 2))
  .y(d => y(d.length));

g.append("path")
  .datum(bins)
  .attr("fill", "none")
  .attr("stroke", "#047857")
  .attr("stroke-width", 2)
  .attr("opacity", 0.9)
  .attr("d", line);

}

/**************************************************************
 * PLAYER FINDER (Cell 3) – top 3 players by filters
 **************************************************************/
function runPlayerFinder() {
  const container = d3.select("#player-finder-results");
  if (!container.node()) return;
  container.selectAll("*").remove();

  const players = getFilteredPlayers();
  if (!players.length) {
    container.append("div").text("No players available.");
    return;
  }

  const minOVR = finderCriteria.min;
  const maxOVR = finderCriteria.max;
  const role = finderCriteria.role;
  const clusterVal = finderCriteria.cluster;

  let candidates = players.filter(p => p.OVR >= minOVR && p.OVR <= maxOVR);

  const attackRoles = ["ST", "CF", "LW", "RW", "LM", "RM"];
  const midRoles = ["CAM", "CM", "CDM", "LAM", "RAM"];
  const defRoles = ["CB", "LB", "RB", "LWB", "RWB", "SW"];

  if (role === "attack") {
    candidates = candidates.filter(p => attackRoles.includes(p.Position));
  } else if (role === "midfield") {
    candidates = candidates.filter(p => midRoles.includes(p.Position));
  } else if (role === "defence") {
    candidates = candidates.filter(p => defRoles.includes(p.Position));
  }

  if (clusterVal !== "any") {
    const clusterIndex = parseInt(clusterVal, 10);
    candidates = candidates.filter(p => p.clusterId === clusterIndex);
  }

  // Name search filter (optional)
  if (finderCriteria.name && finderCriteria.name.length) {
    const q = finderCriteria.name.toLowerCase();
    candidates = candidates.filter(p => (p.Name || '').toLowerCase().includes(q));
  }

  if (!candidates.length) {
    container.append("div").text("No players match the current filters.");
    return;
  }

  // return top 5 players instead of top 3
  const topN = candidates
    .slice()
    .sort((a, b) => b.OVR - a.OVR)
    .slice(0, 5);

  topN.forEach((p, idx) => {
    const card = container.append("div").attr("class", "player-card");
    card.style('cursor', 'pointer');
    card.on('click', () => setActivePlayer(p));

    const header = card.append("div").attr("class", "player-card-header");
    header.append("div").text(`#${idx + 1} ${p.Name}`);
    header.append("div").text(`OVR ${p.OVR}`);

    const main = card.append("div").attr("class", "player-card-main");

    const left = main.append("div");
    left.append("div").attr("class", "player-label")
      .text(`Pos: ${p.Position || "N/A"}`);
    left.append("div").attr("class", "player-label")
      .text(`Nation: ${p.Nation || "N/A"}`);

    const right = main.append("div");
    right.append("div").attr("class", "player-label")
      .text(`Club: ${p.Team || "N/A"}`);

    const clusterLabel = clusterMeta.find(cm => cm.index === p.clusterId);
    if (clusterLabel) {
      right.append("div").attr("class", "player-label")
        .text(`Cluster: C${clusterLabel.index + 1} – ${clusterLabel.label}`);
    }
  });
}
