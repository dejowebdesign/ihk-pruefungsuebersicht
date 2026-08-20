// Typed client for the Hono backend API. All data comes from here — the
// frontend never touches Google Sheets.

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

export interface ApiError {
  error: string;
}

export interface ImportRun {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  sheetsDetected: number;
  sheetsImported: number;
  sheetFailures: number;
  ihkLocations: number;
  questions: number;
  caseExamples: number;
  changeCount: number;
  lastError: string | null;
}

export interface ImportStatus {
  lastSuccess: (ImportRun & { lastError: string | null }) | null;
  lastAttempt: ImportRun | null;
}

export interface SheetMeta {
  id: string;
  gid: string;
  originalName: string;
  sheetType: string;
  headers: unknown[];
  numRows: number;
  numCols: number;
  importRunId: string;
  _count?: { rawRows: number };
}

export interface IhkLocation {
  id: string;
  nr: number;
  ihkShortName: string;
  officialName: string;
  skp: string | null;
  bundesland: string | null;
  writtenForm: string | null;
  writtenResultImmediate: string | null;
  sameDay: string | null;
  intervalWrittenOral: string | null;
  examinerCount: string | null;
  groupFormat: string | null;
  fallbeispiel: string | null;
  koFallbeispiel: string | null;
  punktesystem: string | null;
  vorbereitung: string | null;
  notizen: string | null;
  dataState: string | null;
  lastUpdatedRaw: string | null;
  bezirk: string | null;
  adresse: string | null;
  telefon: string | null;
  website: string | null;
  ansprechpartner: string | null;
  durchwahl: string | null;
  email: string | null;
  routeUrl: string | null;
  sourceSheetId: string;
}

export interface IhkDetail extends IhkLocation {
  sourceSheet: {
    id: string;
    originalName: string;
    gid: string;
    sheetType: string;
  };
  importRun: {
    id: string;
    startedAt: string;
    finishedAt: string | null;
  };
  semantics: Array<{ field: string; value: string | null }>;
}

export interface Question {
  id: string;
  masterId: string | null;
  category: string | null;
  question: string;
  answer: string | null;
  legalBasis: string | null;
  difficulty: string | null;
  cluster: string | null;
  followUp1: string | null;
  followUp2: string | null;
}

export interface CaseExample {
  id: string;
  masterId: string | null;
  category: string | null;
  scenario: string;
  perfectAnswer: string | null;
  legalBasis: string | null;
  difficulty: string | null;
  cluster: string | null;
  followUp1: string | null;
  answer1: string | null;
  followUp2: string | null;
  answer2: string | null;
}

export interface SchedulerStatus {
  running: boolean;
  intervalHours: number;
  lastSuccess: ImportRun | null;
  lastAttempt: ImportRun | null;
}

// ── Oral exam (Phase 8) ────────────────────────────────────────────────────

export interface OralTheme {
  id: string;
  orderKey: number;
  name: string;
  weight: number;
}

export interface OralQuestion {
  id: string;
  excelId: string;
  themeId: string;
  nr: number | null;
  source: string | null;
  question: string;
  answer: string | null;
  checked: string | null;
  theme: { name: string; weight: number; orderKey: number };
}

export type OralRating = "richtig" | "teilweise richtig" | "falsch";

export interface OralExamQuestion {
  id: string;
  examId: string;
  questionId: string;
  orderKey: number;
  themeName: string;
  weight: number;
  rating: OralRating | null;
  points: number;
  note: string | null;
  question: { excelId: string; question: string; answer: string | null; source: string | null };
}

export interface OralExam {
  id: string;
  candidateId: string;
  candidate: { id: string; name: string };
  examDate: string | null;
  examiner: string | null;
  status: "draft" | "in_progress" | "completed";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  maxPoints: number;
  totalPoints: number;
  percent: number;
  result: "Bestanden" | "Nicht bestanden" | null;
  items?: OralExamQuestion[];
}

export interface OralExamScore {
  id: string;
  maxPoints: number;
  totalPoints: number;
  percent: number;
  result: "Bestanden" | "Nicht bestanden" | null;
  status: "draft" | "in_progress" | "completed";
}

export interface OralCreateInput {
  candidateName: string;
  examDate?: string | null;
  examiner?: string | null;
  status?: "draft" | "in_progress" | "completed";
}

export interface OralUpdateInput {
  examDate?: string | null;
  examiner?: string | null;
  status?: "draft" | "in_progress" | "completed";
}

export interface OralRateInput {
  rating?: OralRating | null;
  note?: string | null;
}

export interface AdminStatus {
  lastSuccess: ImportRun | null;
  lastAttempt: ImportRun | null;
  scheduler: SchedulerStatus;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "error" in (body as object)
        ? String((body as ApiError).error)
        : null) || "Die Daten konnten momentan nicht geladen werden.";
    throw new ApiClientError(msg, res.status);
  }
  return body as T;
}

export class ApiClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

export interface IhkListParams {
  page?: number;
  limit?: number;
  bundesland?: string;
  skp?: string;
  writtenForm?: string;
  writtenResultImmediate?: string;
  sameDay?: string;
  intervalWrittenOral?: string;
  groupFormat?: string;
  sort?: string;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  health: () =>
    request<{ status: string; database: string; timestamp: string; version: string }>("/api/health"),
  importStatus: () => request<ImportStatus>("/api/import/status"),
  importRuns: (page = 1, limit = 20) =>
    request<Paginated<ImportRun>>(`/api/import/runs${buildQuery({ page, limit })}`),

  ihkList: (params: IhkListParams = {}) =>
    request<Paginated<IhkLocation>>(
      `/api/ihk${buildQuery(params as Record<string, string | number | undefined>)}`,
    ),
  ihkSearch: (q: string, page = 1, limit = 50) =>
    request<Paginated<IhkLocation>>(`/api/ihk/search${buildQuery({ q, page, limit })}`),
  ihkDetail: (id: string) => request<IhkDetail>(`/api/ihk/${id}`),

  sheets: (page = 1, limit = 50, sheetType?: string) =>
    request<Paginated<SheetMeta>>(`/api/sheets${buildQuery({ page, limit, sheetType })}`),

  questions: (
    page = 1,
    limit = 50,
    q?: string,
    category?: string,
    difficulty?: string,
    cluster?: string,
  ) =>
    request<Paginated<Question>>(
      `/api/questions${buildQuery({ page, limit, q, category, difficulty, cluster })}`,
    ),
  caseExamples: (page = 1, limit = 50, q?: string, category?: string, cluster?: string) =>
    request<Paginated<CaseExample>>(`/api/case-examples${buildQuery({ page, limit, q, category, cluster })}`),

  adminStatus: (token: string) =>
    request<AdminStatus>("/api/admin/status", { headers: { Authorization: `Bearer ${token}` } }),
  adminScheduler: (token: string) =>
    request<SchedulerStatus>("/api/admin/scheduler", { headers: { Authorization: `Bearer ${token}` } }),
  adminImport: (token: string) =>
    request<{ message: string; runId?: string }>("/api/admin/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),

  // ── Oral exam (Phase 8) ──────────────────────────────────────────────────
  oralThemes: () => request<{ data: OralTheme[] }>("/api/oral/themes"),
  oralPool: (page = 1, limit = 300) =>
    request<Paginated<OralQuestion>>(`/api/oral/pool${buildQuery({ page, limit })}`),
  oralExams: (page = 1, limit = 50) =>
    request<Paginated<OralExam>>(`/api/oral/exams${buildQuery({ page, limit })}`),
  oralExam: (id: string) => request<OralExam>(`/api/oral/exams/${id}`),
  oralExamScore: (id: string) => request<OralExamScore>(`/api/oral/exams/${id}/score`),

  oralCreateExam: (token: string, input: OralCreateInput) =>
    request<{ examId: string }>("/api/oral/exams", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    }),
  oralRateQuestion: (token: string, examId: string, order: number, input: OralRateInput) =>
    request<{ ok: true }>(`/api/oral/exams/${examId}/questions/${order}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    }),
  oralCompleteExam: (token: string, examId: string) =>
    request<{ ok: true }>(`/api/oral/exams/${examId}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),
  oralUpdateExam: (token: string, examId: string, input: OralUpdateInput) =>
    request<{ ok: true }>(`/api/oral/exams/${examId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    }),
  oralDeleteExam: (token: string, examId: string) =>
    request<{ ok: true }>(`/api/oral/exams/${examId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }),
  oralSeedPool: (token: string) =>
    request<{ message: string; themes: number; questions: number }>("/api/oral/seed", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),
  /**
   * Download the PDF evaluation for a completed exam. Returns the binary PDF
   * (so callers can trigger a browser download). Does NOT go through the JSON
   * `request()` helper because the response is not JSON.
   */
  oralExamPdfUrl: (examId: string, download = false) =>
    `/api/oral/exams/${examId}/pdf${download ? "?download=1" : ""}`,
};
