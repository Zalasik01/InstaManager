// Arquivo permanente das fotos no Google Drive: PASTA_RAIZ/AAAA/MM/DD/arquivo.jpg
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.
//
// Por que OAuth e não conta de serviço: conta de serviço não tem cota no Drive pessoal
// (erro storageQuotaExceeded). Por isso o upload usa o refresh token da conta do dono.
//
// Por que o escopo completo "drive" e não "drive.file": o drive.file só enxerga arquivos e
// pastas criados pelo próprio app. A pasta raiz já existe (criada pelo dono, fora do app),
// então com drive.file ela ficaria invisível e as buscas/uploads falhariam com 404.

const PASTA_RAIZ = "1Du6uK4QpgrF_iVdpFViZ_GdYWwMSj0Me";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const MIME_PASTA = "application/vnd.google-apps.folder";

let tokenCache: { valor: string; expiraEm: number } | null = null;

function segredo(nome: string): string {
  const v = Deno.env.get(nome);
  if (!v) throw new Error(`Drive: secret ${nome} não configurado`);
  return v;
}

async function lerErro(r: Response): Promise<string> {
  const t = await r.text();
  try {
    const j = JSON.parse(t);
    return j?.error?.message ?? j?.error_description ?? j?.error ?? t;
  } catch {
    return t || String(r.status);
  }
}

async function accessToken(): Promise<string> {
  // Margem de 60 s para não usar um token quase vencido.
  if (tokenCache && Date.now() < tokenCache.expiraEm - 60_000) return tokenCache.valor;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: segredo("GOOGLE_CLIENT_ID"),
      client_secret: segredo("GOOGLE_CLIENT_SECRET"),
      refresh_token: segredo("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) {
    throw new Error(
      `Drive: não consegui renovar o acesso (${await lerErro(r)}). ` +
        "Se for invalid_grant, gere um novo refresh token (docs/google-drive.md).",
    );
  }
  const j = await r.json();
  tokenCache = { valor: j.access_token, expiraEm: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return tokenCache.valor;
}

// deno-lint-ignore no-explicit-any
async function driveFetch(url: string, init: RequestInit, acao: string): Promise<any> {
  const r = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await accessToken()}` },
  });
  if (!r.ok) throw new Error(`Drive: falha ao ${acao} (${r.status}): ${await lerErro(r)}`);
  return r.json();
}

/** Acha a subpasta pelo nome dentro do pai; se não existir, cria. Devolve o id. */
async function acharOuCriarPasta(nome: string, pai: string): Promise<string> {
  // Na sintaxe do "q", barra invertida e aspa simples precisam de escape.
  const nomeEscapado = nome.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = `name = '${nomeEscapado}' and mimeType = '${MIME_PASTA}' and '${pai}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: "files(id)",
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const lista = await driveFetch(`${API}/files?${params}`, {}, `procurar a pasta ${nome}`);
  if (lista.files?.length) return lista.files[0].id;

  const criada = await driveFetch(
    `${API}/files?supportsAllDrives=true&fields=id`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nome, mimeType: MIME_PASTA, parents: [pai] }),
    },
    `criar a pasta ${nome}`,
  );
  return criada.id;
}

/** Manda um arquivo para a lixeira do Drive (recuperável por 30 dias). Arquivo que já não existe (404) é ignorado. */
export async function moverParaLixeira(id: string): Promise<void> {
  const r = await fetch(`${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
  if (!r.ok && r.status !== 404) {
    throw new Error(`Drive: falha ao mandar para a lixeira (${r.status}): ${await lerErro(r)}`);
  }
}

/** Envia o JPEG para PASTA_RAIZ/AAAA/MM/DD (data em UTC, igual ao caminho do Storage). Devolve o id do arquivo. */
export async function enviarParaDrive(bytes: Uint8Array, nomeArquivo: string, data: Date): Promise<string> {
  const ano = String(data.getUTCFullYear());
  const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(data.getUTCDate()).padStart(2, "0");

  let pai = PASTA_RAIZ;
  for (const nome of [ano, mes, dia]) pai = await acharOuCriarPasta(nome, pai);

  // Upload multipart/related: parte 1 = metadados JSON, parte 2 = bytes do JPEG.
  const limite = `instamanager_${crypto.randomUUID()}`;
  const enc = new TextEncoder();
  const cabeca = enc.encode(
    `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name: nomeArquivo, parents: [pai] }) +
      `\r\n--${limite}\r\nContent-Type: image/jpeg\r\n\r\n`,
  );
  const rabo = enc.encode(`\r\n--${limite}--`);
  const corpo = new Uint8Array(cabeca.length + bytes.length + rabo.length);
  corpo.set(cabeca, 0);
  corpo.set(bytes, cabeca.length);
  corpo.set(rabo, cabeca.length + bytes.length);

  const arq = await driveFetch(
    `${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${limite}` },
      body: corpo,
    },
    `enviar o arquivo ${nomeArquivo}`,
  );
  return arq.id;
}
