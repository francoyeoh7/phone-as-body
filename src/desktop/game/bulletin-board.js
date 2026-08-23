// Bulletin board: auto-posted tasks plus player sale listings. Tasks are
// exclusive — once claimed, nobody else can take that posting. Pure logic;
// the relay layer can broadcast the same transitions for real multiplayer.

let taskSeq = 0;

export function createBulletinBoard({ tasks = [], seed = 1 } = {}) {
  let rngState = seed >>> 0 || 1;
  const random = () => {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { random, tasks: [...tasks], listings: [] };
}

export function postTask(board, { description, reward }) {
  const task = {
    id: `task-${++taskSeq}`,
    description,
    reward: Math.max(1, Math.round(reward)),
    claimedBy: null,
    done: false,
  };
  board.tasks.push(task);
  return task;
}

// Auto-post a themed errand with a deterministic reward.
const TASK_TEMPLATES = [
  { description: "去水阀检查漏水", reward: [40, 80] },
  { description: "去钟楼敲响钟", reward: [60, 110] },
  { description: "去发电机重启电路", reward: [80, 150] },
  { description: "去酒馆清点存货", reward: [50, 90] },
];

export function postAutoTask(board) {
  const template = TASK_TEMPLATES[Math.floor(board.random() * TASK_TEMPLATES.length)];
  const [min, max] = template.reward;
  const reward = min + Math.floor(board.random() * (max - min + 1));
  return postTask(board, { description: template.description, reward });
}

export function claimTask(board, taskId, playerId) {
  const task = board.tasks.find((entry) => entry.id === taskId);
  if (!task || task.done) return { ok: false, reason: "gone" };
  if (task.claimedBy && task.claimedBy !== playerId) return { ok: false, reason: "claimed" };
  task.claimedBy = playerId;
  return { ok: true, task };
}

export function completeTask(board, taskId, playerId) {
  const task = board.tasks.find((entry) => entry.id === taskId);
  if (!task || task.done) return { ok: false, reason: "gone" };
  if (task.claimedBy !== playerId) return { ok: false, reason: "not-yours" };
  task.done = true;
  return { ok: true, reward: task.reward };
}

// Player sale listings: post an item for a price; anyone else can buy it.
export function postListing(board, { sellerId, itemId, label, price }) {
  const listing = {
    id: `listing-${board.listings.length + 1}`,
    sellerId,
    itemId,
    label,
    price: Math.max(1, Math.round(price)),
    sold: false,
  };
  board.listings.push(listing);
  return listing;
}

export function buyListing(board, listingId, buyerId) {
  const listing = board.listings.find((entry) => entry.id === listingId);
  if (!listing || listing.sold) return { ok: false, reason: "gone" };
  if (listing.sellerId === buyerId) return { ok: false, reason: "self" };
  listing.sold = true;
  return { ok: true, listing };
}
