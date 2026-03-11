## Wordweave Prototype

Local-first Infinite Craft–style prototype with:

- React + Vite client
- React Flow graph view
- Express + SQLite (via `sql.js`) API
- OpenAI-powered multi-input crafting using `gpt-5-mini`

### Tech Stack

- **Client**: React + TypeScript + Vite, React Flow for the crafting graph
- **API**: Express + TypeScript, SQLite stored on disk via `sql.js`
- **LLM**: OpenAI `gpt-5-mini`, called from the backend only

Repo layout:

- `apps/client` – Vite React app (UI)
- `apps/api` – Express + SQLite API
- `packages/shared` – shared DTO types (used for typing only)

---

### Prerequisites

- Node.js (LTS recommended)
- An OpenAI API key with access to `gpt-5-mini`

---

### Environment Variables

At the repo root:

1. Copy the example file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and set:

   - **`OPENAI_API_KEY`** – your OpenAI API key
   - **`API_PORT`** (optional, default `4000`)
   - **`CLIENT_PORT`** (optional, default `5173`)

The `.env` file is read by the API; the client talks to `http://localhost:4000/api` by default unless you override `VITE_API_BASE_URL` in a client-side `.env` if desired.

---

### Install Dependencies

From the repo root:

```bash
npm install
```

This will install dependencies for the root, `apps/api`, `apps/client`, and `packages/shared`.

---

### Running the API Only

From the repo root:

```bash
npm run dev:api
```

- Starts the Express API with hot-reload (ts-node-dev).
- Default base URL: `http://localhost:4000/api`.
- On first run, a SQLite database file is created at `apps/api/data/craft.db` and seeded with four base elements (Fire, Water, Earth, Air).

Key API routes:

- `POST /api/recipes/combine`
  - Body: `{ "inputs": string[] }`
  - Normalizes, looks up or generates candidate results with OpenAI, and returns:
    - the recipe id
    - the normalized input set
    - the candidate list (name + emoji)
    - the chosen result (if already selected)
- `POST /api/recipes/:id/select`
  - Body: `{ "candidateId": number }`
  - Persists the selected candidate as the canonical result and creates/links the resulting element.
- `GET /api/elements`
  - Optional query `?q=search` to filter by element name.
- `GET /api/elements/recent-recipes`
  - Returns recent canonical recipes with inputs and resulting element for the graph.
- `GET /api/health`
  - Simple readiness check.

---

### Running the Client Only

From the repo root:

```bash
npm run dev:client
```

Then open:

- `http://localhost:5173` (or your configured `CLIENT_PORT`)

Make sure the API is also running so the client can load elements and generate combinations.

---

### Running Client and API Together

From the repo root:

```bash
npm run dev
```

This runs:

- `npm run dev:api` in one process
- `npm run dev:client` in another

You can then use the app at `http://localhost:5173`.

---

### Gameplay / UX Notes

- Start from the **four base elements** in the left sidebar.
- Click elements to add them to the **combine tray** at the bottom.
- Press **Combine**:
  - The API will normalize your inputs, check for a saved recipe, and if none exists, call OpenAI with the prompt described in the spec.
  - You’ll see **1–4 candidate results** (name + emoji).
- Click one candidate:
  - It becomes the canonical result for this exact normalized input set.
  - The resulting element is added to your **discovered elements**.
  - The **graph** updates to show inputs → recipe → result.
- Use the **search box** to quickly find elements.
- The **Recent creations** panel shows a compact list of your latest canonical results.

This prototype is designed for a single local user, optimized for simplicity and fast iteration rather than multi-user scale.

