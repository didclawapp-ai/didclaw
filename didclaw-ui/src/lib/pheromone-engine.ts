/**
 * Pheromone Memory Engine
 *
 * Maintains a dynamic cognitive map of the user's conversation habits.
 * High-frequency topics accumulate "pheromone strength"; unused ones decay.
 * The resulting map is periodically injected into AGENTS.md so the AI
 * naturally prioritises familiar paths without being explicitly told.
 */

export interface PheromoneNode {
  count: number;
  lastSeen: string;   // ISO date string YYYY-MM-DD
  strength: number;   // 0–1; 1 = very familiar
  depth: number;      // estimated cognitive depth 1–5
  blocked?: boolean;  // user hit a knowledge wall here
  dormant?: boolean;  // strength fell below threshold
}

export interface PheromoneEdge {
  weight: number;
  lastSeen: string;
}

export interface BlockedPoint {
  node: string;
  context: string;
  since: string;
}

export interface PheromoneGraph {
  version: string;
  lastDecay: string;   // ISO date YYYY-MM-DD
  nodes: Record<string, PheromoneNode>;
  edges: Record<string, PheromoneEdge>;  // "A→B"
  blockedPoints: BlockedPoint[];
}

const GRAPH_VERSION = "0.1.0";
const DECAY_RATE = 0.97;        // per-day strength multiplier
const DORMANT_THRESHOLD = 0.05;
const STRENGTH_GAIN = 0.06;     // per mention
const MAX_TOPICS_PER_TURN = 6;
const MAX_HOT_NODES = 12;
const MAX_HOT_EDGES = 6;
const INJECT_INTERVAL_RUNS = 5; // inject to AGENTS.md every N runs

// Common stop words to filter out of topic extraction
const STOP_WORDS = new Set([
  // English
  "the","a","an","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","shall","should","may","might","must","can",
  "could","i","you","he","she","it","we","they","me","him","her","us","them",
  "my","your","his","its","our","their","this","that","these","those","what",
  "which","who","whom","how","when","where","why","all","any","both","each",
  "more","most","other","some","such","no","nor","not","only","own","same",
  "so","than","too","very","just","but","and","or","as","at","by","for","in",
  "of","on","to","up","with","from","into","about","like","also","then","than",
  "if","but","because","while","although","though","since","until","unless",
  "ok","okay","yes","no","hi","hello","thanks","thank","please","sorry","sure",
  // Chinese
  "的","了","在","是","我","你","他","她","它","们","这","那","有","和","就","不","也",
  "都","而","及","与","着","或","于","一个","可以","什么","怎么","如何","可能","应该",
  "需要","我们","你们","他们","因为","所以","但是","然后","如果","虽然","对于","关于",
  "通过","进行","使用","没有","一些","这些","那些","这个","那个","这里","那里","现在",
  "时候","好的","谢谢","请问","您好","对","嗯","吗","呢","啊","哦","哈","嗯嗯",
  "一下","一点","已经","还是","只是","其实","不是","还有","就是","来说","来看",
]);

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return Math.max(0, Math.round(Math.abs(b - a) / 86_400_000));
}

/**
 * Extract meaningful topic tokens from a piece of text.
 * Uses simple tokenisation — no external NLP needed for MVP.
 */
export function extractTopics(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  // Normalise: remove markdown syntax, code fences, URLs
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_~>|[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const freq: Record<string, number> = {};

  // Chinese segments: consecutive CJK characters (1–6 chars is a good phrase range)
  const cnMatches = cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf]{2,6}/g) ?? [];
  for (const w of cnMatches) {
    if (!STOP_WORDS.has(w)) freq[w] = (freq[w] ?? 0) + 1;
  }

  // English words: alpha sequences ≥ 3 chars
  const enMatches = cleaned.match(/[a-zA-Z]{3,}/g) ?? [];
  for (const w of enMatches) {
    const lw = w.toLowerCase();
    if (!STOP_WORDS.has(lw) && lw.length >= 3) {
      freq[lw] = (freq[lw] ?? 0) + 1;
    }
  }

  // Sort by frequency descending, return top N
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOPICS_PER_TURN)
    .map(([w]) => w);
}

/** Detect potential blocked points: user expressing confusion or lack of knowledge */
export function detectBlockedTopics(userText: string): string[] {
  const BLOCK_PATTERNS = [
    /不(?:知道|懂|了解|明白|清楚)(.{2,10})/g,
    /(?:不太|完全不|没有)(?:了解|明白|理解)(.{2,10})/g,
    /(?:i don'?t know|i'?m not sure about|don'?t understand)\s+(.{3,30})/gi,
    /(?:what is|what are|explain)\s+(.{3,30})/gi,
  ];
  const blocked: string[] = [];
  for (const re of BLOCK_PATTERNS) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(userText)) !== null) {
      const topic = m[1].trim().replace(/[？?。，,！!]$/, "");
      if (topic && !STOP_WORDS.has(topic.toLowerCase())) {
        blocked.push(topic);
      }
    }
  }
  return blocked;
}

export function emptyGraph(): PheromoneGraph {
  return {
    version: GRAPH_VERSION,
    lastDecay: todayStr(),
    nodes: {},
    edges: {},
    blockedPoints: [],
  };
}

/**
 * Update the graph after a completed conversation turn.
 */
export function updateGraph(
  graph: PheromoneGraph,
  userText: string,
  assistantText: string,
): PheromoneGraph {
  const today = todayStr();
  const g: PheromoneGraph = structuredClone(graph);

  const userTopics = extractTopics(userText);
  const assistantTopics = extractTopics(assistantText);
  // Union; user topics weighted slightly higher
  const allTopics = [...new Set([...userTopics, ...assistantTopics])].slice(0, MAX_TOPICS_PER_TURN);

  // Update nodes
  for (const topic of allTopics) {
    const existing = g.nodes[topic];
    if (existing) {
      existing.count += 1;
      existing.strength = Math.min(1.0, existing.strength + STRENGTH_GAIN);
      existing.lastSeen = today;
      existing.dormant = false;
      // Heuristic: depth increases if topic appears in both user and assistant output
      if (userTopics.includes(topic) && assistantTopics.includes(topic)) {
        existing.depth = Math.min(5, existing.depth + 0.2);
      }
    } else {
      g.nodes[topic] = {
        count: 1,
        lastSeen: today,
        strength: STRENGTH_GAIN,
        depth: userTopics.includes(topic) ? 2 : 1,
      };
    }
  }

  // Update edges (all pairs among user topics)
  for (let i = 0; i < userTopics.length; i++) {
    for (let j = i + 1; j < userTopics.length; j++) {
      const key = `${userTopics[i]}→${userTopics[j]}`;
      const e = g.edges[key];
      if (e) {
        e.weight += 1;
        e.lastSeen = today;
      } else {
        g.edges[key] = { weight: 1, lastSeen: today };
      }
    }
  }

  // Detect blocked points from user text
  const blocked = detectBlockedTopics(userText);
  for (const bTopic of blocked) {
    if (!g.blockedPoints.find((b) => b.node === bTopic)) {
      g.blockedPoints.push({
        node: bTopic,
        context: userText.slice(0, 80).trim(),
        since: today,
      });
      // Mark node as blocked if it exists
      if (g.nodes[bTopic]) g.nodes[bTopic].blocked = true;
    }
  }

  return g;
}

/**
 * Apply time-based decay to all nodes and edges.
 * Should be called at most once per day.
 */
export function applyDecay(graph: PheromoneGraph): PheromoneGraph {
  const today = todayStr();
  const g: PheromoneGraph = structuredClone(graph);
  const daysSinceLast = daysBetween(g.lastDecay, today);

  if (daysSinceLast === 0) return g;

  const factor = Math.pow(DECAY_RATE, daysSinceLast);

  for (const key in g.nodes) {
    const n = g.nodes[key];
    n.strength = n.strength * factor;
    if (n.strength < DORMANT_THRESHOLD) {
      n.dormant = true;
    }
  }

  for (const key in g.edges) {
    const e = g.edges[key];
    e.weight = e.weight * factor;
    if (e.weight < 0.5) {
      delete g.edges[key];
    }
  }

  g.lastDecay = today;
  return g;
}

/**
 * Generate the markdown section to inject into AGENTS.md.
 */
export function generateMemorySection(graph: PheromoneGraph): string {
  const hotNodes = Object.entries(graph.nodes)
    .filter(([, n]) => !n.dormant && n.strength >= 0.1)
    .sort((a, b) => b[1].strength - a[1].strength)
    .slice(0, MAX_HOT_NODES);

  const hotEdges = Object.entries(graph.edges)
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, MAX_HOT_EDGES);

  const activeBlocked = graph.blockedPoints.slice(-5);

  const lines: string[] = [
    "## User Cognitive Map (auto-generated by DidClaw · do not edit this section)",
    "",
    "### Frequent Topics",
  ];

  if (hotNodes.length === 0) {
    lines.push("- (not enough data yet)");
  } else {
    for (const [topic, n] of hotNodes) {
      const bar = "█".repeat(Math.round(n.strength * 5));
      lines.push(`- **${topic}** ${bar} (depth ${Math.round(n.depth)}, ${n.count} mentions)`);
    }
  }

  if (hotEdges.length > 0) {
    lines.push("", "### Common Associations");
    for (const [edge] of hotEdges) {
      lines.push(`- ${edge.replace("→", " → ")}`);
    }
  }

  if (activeBlocked.length > 0) {
    lines.push("", "### Knowledge Boundaries (user indicated uncertainty)");
    for (const b of activeBlocked) {
      lines.push(`- **${b.node}**: ${b.context.slice(0, 60)}…`);
    }
  }

  lines.push(
    "",
    `_Updated ${new Date().toISOString().slice(0, 10)} · ${hotNodes.length} active topics_`,
  );

  return lines.join("\n");
}

/** Returns true if the graph has accumulated enough runs to warrant an AGENTS.md injection. */
export function shouldInjectMemory(graph: PheromoneGraph, runsSinceLastInject: number): boolean {
  const hasData = Object.values(graph.nodes).some((n) => n.count >= 2);
  return hasData && runsSinceLastInject >= INJECT_INTERVAL_RUNS;
}
