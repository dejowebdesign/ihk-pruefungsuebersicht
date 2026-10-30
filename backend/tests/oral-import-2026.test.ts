// Import gate for the 35 questions added in 2026 (27 "Umgang mit Waffen",
// 8 "Straf- und Verfahrensrecht").
//
// The import rules were: copy verbatim, do not reword, do not shorten, invent
// nothing, never touch an existing record, skip exact duplicates, map each
// question to the right Themenbereich. These tests assert exactly that — the
// expected text below is the authoritative copy of the task's original wording,
// so a future edit to the seed file that silently rewrites an imported answer
// fails here.
//
// Scope note: like oral-question-quality.test.ts, this asserts *textual*
// fidelity and import mechanics. It makes no claim about legal correctness;
// that lives in docs/oral-import-2026-review.md.

import { describe, it, expect } from "vitest";
import seedRaw from "../prisma/seed/oral-questions.json";
import { ORAL_THEMES } from "../src/oral/themes";

type SeedRow = {
  excelId: string;
  thema: string;
  nr: number | null;
  quelle: string | null;
  frage: string;
  erw: string | null;
  geprueft: string | null;
};

const rows = seedRaw as SeedRow[];
const UMW = "Umgang mit Waffen";
const STGB = "Straf- und Verfahrensrecht";

/** excelIds assigned by the import, in source order (Frage 1..35). */
const IMPORTED_UMW = Array.from({ length: 27 }, (_, i) => `UmW-${32 + i}`);
const IMPORTED_STGB = Array.from({ length: 8 }, (_, i) => `StGB-${59 + i}`);
const IMPORTED = [...IMPORTED_UMW, ...IMPORTED_STGB];

/**
 * The 35 imported pairs, verbatim, in the order of the source document.
 * `[excelId, thema, frage, erw]`.
 */
const EXPECTED: Array<[string, string, string, string]> = [
  [
    "UmW-32",
    UMW,
    "Was bedeutet \u201eerwerben\u201c im Sinne des Waffengesetzes?",
    "Das Erlangen der tats\u00e4chlichen Gewalt \u00fcber die Schusswaffe.",
  ],
  [
    "UmW-33",
    UMW,
    "Wer gilt als Erwerber einer Waffe und auf welche Weise kann eine Person die tats\u00e4chliche Gewalt \u00fcber eine Waffe erlangen? Nennen Sie Beispiele.",
    "Als Erwerber gilt jede Person, die die tats\u00e4chliche Gewalt \u00fcber eine Waffe erlangt. Dies kann beispielsweise geschehen durch:\n\n- Kauf: Eine Person kauft eine Waffe und nimmt sie in Besitz.\n- Diebstahl: Eine Person entwendet eine Waffe und bringt sie unter ihre Kontrolle.\n- Finden: Eine Person findet eine Waffe und nimmt sie an sich.",
  ],
  [
    "UmW-34",
    UMW,
    "Wer ist sachkundig im Sinne des Waffengesetzes?",
    "Wer die Waffensachkundepr\u00fcfung erfolgreich abgelegt hat oder eine Gesellenpr\u00fcfung im B\u00fcchsenmacherhandwerk erfolgreich abgelegt hat.",
  ],
  [
    "UmW-35",
    UMW,
    "Was bedeutet \u201eF\u00fchren\u201c im Sinne des Waffengesetzes?",
    "Das Aus\u00fcben der tats\u00e4chlichen Gewalt au\u00dferhalb der eigenen Wohnung, Gesch\u00e4fts-r\u00e4ume, des eigenen befriedeten Besitztums oder einer Schie\u00dfst\u00e4tte.",
  ],
  [
    "UmW-36",
    UMW,
    "Durch wen und wie wird im Sinne des Waffengesetzes die pers\u00f6nliche Eignung einer Person festgestellt?",
    "Die pers\u00f6nliche Eignung wird von der zust\u00e4ndigen Beh\u00f6rde gepr\u00fcft; ggf. ist ein amts- oder fach\u00e4rztliches oder fachpsychologisches Zeugnis beizubringen.",
  ],
  [
    "UmW-37",
    UMW,
    "Wann ist eine Waffe \u201eschussbereit\u201c?",
    "Wenn Sie geladen ist, d. h. dass Munition oder Geschosse in der Trommel, im in die Waffe eingef\u00fcgten Magazin oder im Patronen- oder Geschosslager sind, auch wenn sie nicht gespannt ist.",
  ],
  [
    "UmW-38",
    UMW,
    "Welche Voraussetzungen m\u00fcssen Sie als Antragsteller f\u00fcr die Erteilung einer Waffenbesitzkarte erf\u00fcllen?",
    "1. Ich muss ein Bed\u00fcrfnis nachweisen.\n2. Ich muss die pers\u00f6nliche Eignung besitzen.\n3. Ich muss die erforderliche Zuverl\u00e4ssigkeit besitzen.\n4. Ich muss die erforderliche Sachkunde nachweisen.\n5. Ich muss das 18. Lebensjahr vollendet haben.(Beachte: Altersbeschr\u00e4nkungen bei Sportsch\u00fctzen)\n6. Nachweise der sicheren Aufbewahrung f\u00fcr Schusswaffen.",
  ],
  [
    "UmW-39",
    UMW,
    "Das Fortbestehen des Bed\u00fcrfnisses wird nach erstmaliger Erteilung einer waffenrechtlichen Erlaubnis von der Beh\u00f6rde gepr\u00fcft. Welche Frist hat der Gesetzgeber hier vorgesehen?",
    "Mindestens alle f\u00fcnf Jahre",
  ],
  [
    "UmW-40",
    UMW,
    "Was sind \u201eAnscheinswaffen\u201c im Sinne des Waffengesetzes?",
    "Schusswaffen, die ihrer \u00e4u\u00dferen Form nach im Gesamterscheinungsbild den Anschein von Feuerwaffen (Anlage 1 Abschnitt 1 Unterabschnitt 1 Nr. 2.1 WaffG) hervorrufen und bei denen zum Antrieb der Geschosse keine hei\u00dfen Gase verwendet werden.\n\nNachbildungen von Schusswaffen mit dem Aussehen der o.g. Schusswaffen und unbrauchbar gemachte Schusswaffen mit dem Aussehen der o.g. Schusswaffen.",
  ],
  [
    "UmW-41",
    UMW,
    "Was muss der Erwerbsberechtigte nach dem Kauf einer Schusswaffe von einer Privatperson/H\u00e4ndler veranlassen?",
    "Er muss innerhalb von zwei Wochen bei der zust\u00e4ndigen Beh\u00f6rde den Erwerb schriftlich oder elektronisch anzeigen und seine Waffenbesitzkarte zur Eintragung vorlegen.",
  ],
  [
    "UmW-42",
    UMW,
    "D\u00fcrfen Schalld\u00e4mpfer f\u00fcr erlaubnis-pflichtige Schusswaffen erworben werden?",
    "Ja, jedoch unterliegen Schalld\u00e4mpfer f\u00fcr erlaubnispflichtige Schusswaffen ebenfalls der Erlaubnispflicht.",
  ],
  [
    "UmW-43",
    UMW,
    "Braucht ein Vollj\u00e4hriger f\u00fcr den Erwerb von Druckluft-, Federdruck- oder CO2-Waffen eine Erwerbsberechtigung?",
    "Nein, wenn die Waffe mit \u201eF im F\u00fcnfeck\u201c gekennzeichnet ist.",
  ],
  [
    "UmW-44",
    UMW,
    "Welche Erlaubnisse berechtigen zum Erwerb von Munition?",
    "1. Waffenbesitzkarte, sofern eine Munitionserwerbsberechtigung eingetragen ist.\n2. G\u00fcltiger Jagdschein (Langwaffenmunition)\n3. Munitionserwerbsschein",
  ],
  [
    "UmW-45",
    UMW,
    "Sie \u00fcberlassen einem Berechtigten auf Dauer Ihr Gro\u00dfkaliber-Sportgewehr. Innerhalb welcher Frist m\u00fcssen Sie Ihrer Beh\u00f6rde das \u00dcberlassen anzeigen?",
    "Innerhalb von 2 Wochen.",
  ],
  [
    "UmW-46",
    UMW,
    "Unter welchen Voraussetzungen darf Ihnen ein Waffenh\u00e4ndler eine erlaubnispflichtige Schusswaffe zum Ausprobieren ohne vorherige Erlaubnis der zust\u00e4ndigen Beh\u00f6rde \u00fcberlassen?",
    "Das ist nur erlaubt, wenn man bereits eine WBK besitzt und der Erwerb vor\u00fcbergehend ist (h\u00f6chstens einen Monat).",
  ],
  [
    "UmW-47",
    UMW,
    "Was hat der Erbe einer Schusswaffe zu veranlassen?",
    "Beantragung einer WBK bei der zust\u00e4ndigen Waffenbeh\u00f6rde binnen eines Monats nach Annahme der Erbschaft.",
  ],
  [
    "UmW-48",
    UMW,
    "Sie wollen eine Waffe mit einem anderen Berechtigten dauerhaft tauschen, was m\u00fcssen Sie ber\u00fccksichtigen?",
    "Ein Waffentausch ist gesetzlich nicht vorgesehen, jeder muss f\u00fcr die angestrebte Waffe erwerbsberechtigt sein und den Erwerb, sowie das \u00dcberlassen der anderen Waffe seiner zust\u00e4ndigen Beh\u00f6rde fristgerecht melden.",
  ],
  [
    "UmW-49",
    UMW,
    "Was darf der Inhaber eines Kleinen Waffenscheins?",
    "Schreckschuss-, Reizstoff- und Signalwaffen mit dem Zulassungszeichen \u201ePTB im Kreis\u201c in der \u00d6ffentlichkeit (ausgenommen \u00f6ffentliche Veranstaltungen) f\u00fchren.",
  ],
  [
    "UmW-50",
    UMW,
    "Wer ist zum zugriffsbereiten F\u00fchren von Schreckschuss-, Reizstoff- und Signalwaffen, deren Erwerb und Besitz erlaubnisfrei ist, berechtigt?",
    "Inhaber des Kleinen Waffenscheines.",
  ],
  [
    "UmW-51",
    UMW,
    "In welchem Beh\u00e4ltnis darf erlaubnis-pflichtige Munition gelagert werden?",
    "Stahlblechbeh\u00e4ltnis mit Schwenkriegelschloss.",
  ],
  [
    "UmW-52",
    UMW,
    "Darf eine Schusswaffe, auch wenn sie ungeladen ist, auf Menschen gerichtet werden?",
    "Nein, au\u00dfer bei Notwehr.",
  ],
  [
    "UmW-53",
    UMW,
    "Wie soll eine Schusswaffe an eine andere Person \u00fcbergeben werden?",
    "Ungeladen.",
  ],
  [
    "UmW-54",
    UMW,
    "Was sollte als erstes geschehen, wenn man eine Schusswaffe \u00fcbergeben bekommt?",
    "Die Waffe ist sofort auf ihren Ladezustand zu \u00fcberpr\u00fcfen.",
  ],
  [
    "UmW-55",
    UMW,
    "Welche Munition d\u00fcrfen Sie aus Ihrer Waffe verschie\u00dfen?",
    "Munition, f\u00fcr die diese Waffe konstruiert und zugelassen ist.",
  ],
  [
    "UmW-56",
    UMW,
    "Nennen Sie mindestens f\u00fcnf Grundregeln zum Umgang mit einer Schusswaffe, die Sie unbedingt beachten m\u00fcssen!",
    "Hier sind allgemeine Sicherheitsregeln zu benennen wie z.B.:\n\n- eine Schusswaffe ist immer als geladen zu betrachten, so lange man sich nicht pers\u00f6nlich vom Gegenteil \u00fcberzeugt hat\n- es ist immer daf\u00fcr Sorge zu tragen, dass kein Unbefugter die Waffe an sich nehmen kann\n- die Waffe darf nur in sicherer Richtung ge- und entladen werden\n- eine geladene Waffe darf nicht aus der Hand gelegt werden\n- eine Schusswaffe darf nicht spielerisch auf Personen gerichtet werden\n- kein Hantieren mit Waffen unter dem Einfluss berauschender Mittel",
  ],
  [
    "UmW-57",
    UMW,
    "Was versteht man unter Gefahrenbereich?",
    "Die H\u00f6chstreichweite von aus Schusswaffen abgefeuerten Geschossen.\n\nDer Bereich, in dem Menschen oder Sachen gef\u00e4hrdet werden k\u00f6nnen.",
  ],
  [
    "UmW-58",
    UMW,
    "Woran erkennen Sie, dass die von Ihnen zu erwerbende Munition zu Ihrer Schusswaffe passt?",
    "Kennzeichnung auf Schusswaffe und Munitionsverpackung / Patronenh\u00fclse identisch.",
  ],
  [
    "StGB-59",
    STGB,
    "Erkl\u00e4ren Sie den Begriff \u201eNotwehrexzess\u201c und seine strafrechtliche Bedeutung!",
    "Beim Notwehrexzess wird das zul\u00e4ssige Ma\u00df der Abwehr \u00fcberschritten.\n\nDas Handeln wird nur dann entschuldigt, wenn in Furcht, Verwirrung oder Schrecken \u00fcber die Grenzen der Notwehr hinausgegangen worden ist.",
  ],
  [
    "StGB-60",
    STGB,
    "Was ist ein Notstand?",
    "Bei einem Notstand besteht eine gegenw\u00e4rtige Gefahr f\u00fcr ein Rechtsgut, die nur durch Verletzung eines anderen Rechtsgutes abgewendet werden kann, wobei eine Abw\u00e4gung der wider-streitenden Interessen stattfinden muss, in deren Ergebnis das als minderwertiger erkannte Rechtsgut geopfert wird.",
  ],
  [
    "StGB-61",
    STGB,
    "Was bedeutet rechtfertigender Notstand?",
    "In rechtfertigendem Notstand handelt, wer in einer gegenw\u00e4rtigen, nicht anders abwendbaren Gefahr f\u00fcr Leben, Leib, Freiheit, Ehre, Eigentum oder ein anderes Rechtsgut eine Tat begeht, um die Gefahr von sich oder einem An-deren abzuwenden, wenn bei Abw\u00e4gung der widerstreitenden Interessen das gesch\u00fctzte Interesse das beeintr\u00e4chtigte wesentlich \u00fcberwiegt.",
  ],
  [
    "StGB-62",
    STGB,
    "Was bedeutet entschuldigender Notstand?",
    "Wer in einer gegenw\u00e4rtigen, nicht anders abwendbaren Gefahr f\u00fcr Leben, Leib oder Freiheit eine rechtswidrige Tat begeht, um die Ge-fahr von sich, einem Angeh\u00f6rigen oder einer anderen ihm nahestehenden Person abzuwenden, handelt ohne Schuld.",
  ],
  [
    "StGB-63",
    STGB,
    "Nennen Sie vier wesentliche Voraussetzungen f\u00fcr den rechtfertigenden Notstand!",
    "1. Gegenw\u00e4rtige Gefahr liegt vor.\n2. Rechtsg\u00fcter sind bedroht (Leben, Leib, Freiheit, Ehre, Eigentum).\n3. Das zu sch\u00fctzende Rechtsgut ist wesentlich h\u00f6herwertiger als das beeintr\u00e4chtigte.\n4. Die Abwehrhandlung muss angemessen sein.",
  ],
  [
    "StGB-64",
    STGB,
    "Was ist ein gegenw\u00e4rtiger Angriff?",
    "Jede unmittelbar bevorstehende, gerade statt-findende oder fortdauernde Verletzung eines Rechtsgutes.",
  ],
  [
    "StGB-65",
    STGB,
    "Welche Verteidigungshandlung ist erforderlich, um einen Angriff abzuwenden?",
    "Die Erforderlichkeit bestimmt sich nach St\u00e4rke und Gef\u00e4hrlichkeit des Angriffs; grunds\u00e4tzlich ist das mildeste Mittel zur Abwehr zu w\u00e4hlen, das erfolgversprechend ist.",
  ],
  [
    "StGB-66",
    STGB,
    "Was bedeutet \u201erechtswidrig\u201c?",
    "Ein Angriff ist rechtswidrig, wenn er gegen eine Rechtsnorm verst\u00f6\u00dft und ein Rechtfertigungsgrund nicht gegeben ist.",
  ],
];

const byId = new Map(rows.map((r) => [r.excelId, r]));

describe("2026 import — the 35 new questions", () => {
  it("created exactly 35 records, 27 for Waffen and 8 for StGB", () => {
    expect(EXPECTED).toHaveLength(35);
    expect(IMPORTED_UMW).toHaveLength(27);
    expect(IMPORTED_STGB).toHaveLength(8);
    for (const id of IMPORTED) expect(byId.has(id), `missing ${id}`).toBe(true);
  });

  it("assigned the ids contiguously after the previous last id of each theme", () => {
    // Previous maxima were UmW-31 and StGB-58 (see AGENTS.md pool history).
    expect(IMPORTED_UMW[0]).toBe("UmW-32");
    expect(IMPORTED_STGB[0]).toBe("StGB-59");
    expect(IMPORTED_UMW.at(-1)).toBe("UmW-58");
    expect(IMPORTED_STGB.at(-1)).toBe("StGB-66");
  });

  it("maps every imported question to the correct Themenbereich", () => {
    for (const [id, thema] of EXPECTED.map(([id, t]) => [id, t] as const)) {
      expect(byId.get(id)!.thema, id).toBe(thema);
    }
    // and the theme totals grew by exactly the imported amounts
    const umw = rows.filter((r) => r.thema === UMW);
    const stgb = rows.filter((r) => r.thema === STGB);
    expect(umw).toHaveLength(58); // 31 before + 27
    expect(stgb).toHaveLength(66); // 58 before + 8
  });

  it("stores every question and answer verbatim (character for character)", () => {
    const drift: string[] = [];
    for (const [id, , frage, erw] of EXPECTED) {
      const r = byId.get(id)!;
      if (r.frage !== frage) drift.push(`${id}.frage`);
      if ((r.erw ?? null) !== erw) drift.push(`${id}.erw`);
    }
    expect(drift).toEqual([]);
  });

  it("keeps the umlauts, ß and typographic quotes the source used", () => {
    // Spot-check the special characters actually present in the import.
    expect(byId.get("UmW-51")!.frage).toContain("Beh\u00e4ltnis");
    expect(byId.get("UmW-58")!.erw).toContain("Patronenh\u00fclse");
    expect(byId.get("UmW-42")!.frage).toContain("Schalld\u00e4mpfer");
    expect(byId.get("UmW-32")!.frage).toContain("\u201eerwerben\u201c"); // „ “
    expect(byId.get("UmW-35")!.erw).toContain("Schie\u00dfst\u00e4tte");
    expect(byId.get("UmW-49")!.erw).toContain("\u00d6ffentlichkeit");
    expect(byId.get("StGB-60")!.erw).toContain("Abw\u00e4gung");
    expect(byId.get("StGB-66")!.erw).toContain("verst\u00f6\u00dft");
  });

  it("does not shorten any answer (multi-item answers keep all their parts)", () => {
    // Count the enumerated items the source listed for these three answers.
    expect(byId.get("UmW-38")!.erw!.split("\n")).toHaveLength(6); // 6 prerequisites
    expect(byId.get("UmW-44")!.erw!.split("\n")).toHaveLength(3); // 3 permits
    // lead-in, blank line, then the six safety rules
    expect(byId.get("UmW-56")!.erw!.split("\n")).toHaveLength(8);
    expect(byId.get("UmW-56")!.erw!.match(/\n- /g)).toHaveLength(6);
    expect(byId.get("StGB-63")!.erw!.split("\n")).toHaveLength(4); // 4 requirements
    // The three bullet lists keep all three examples.
    expect(byId.get("UmW-33")!.erw!.match(/\n- /g)).toHaveLength(3);
  });

  it("carries no invented extra content or options", () => {
    // Nothing in the import mentions answer options or alternatives that the
    // source did not contain.
    const forbidden = [/Antwort [A-D]\)/, /\bMultiple[- ]Choice\b/, /a\)\s.*b\)\s.*c\)/i];
    const hits: string[] = [];
    for (const id of IMPORTED) {
      const r = byId.get(id)!;
      for (const p of forbidden) {
        if (p.test(r.frage) || p.test(r.erw ?? "")) hits.push(`${id}: ${p}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("created no exact duplicate of any pre-existing question", () => {
    // Normalise whitespace so a line-wrap difference cannot mask a duplicate.
    const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
    const importedSet = new Set(IMPORTED);
    const preExisting = rows.filter((r) => !importedSet.has(r.excelId));
    const existingText = new Set(preExisting.map((r) => norm(r.frage)));

    const duplicated: string[] = [];
    for (const id of IMPORTED) {
      if (existingText.has(norm(byId.get(id)!.frage))) duplicated.push(id);
    }
    expect(duplicated).toEqual([]);
  });

  it("keeps each imported question text unique within the whole pool", () => {
    const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const r of rows) {
      const k = norm(r.frage);
      const prev = seen.get(k);
      if (prev) clashes.push(`${prev} == ${r.excelId}`);
      else seen.set(k, r.excelId);
    }
    expect(clashes).toEqual([]);
  });

  it("leaves every pre-existing record byte-identical", () => {
    // The import is append-only. These are the records the audit touched plus
    // the previous last id of each affected theme; all must be unchanged.
    expect(byId.get("UmW-31")!.frage).toBe("Darf ein Diensthund zubei\u00dfen?");
    expect(byId.get("UmW-08")!.frage).toBe("Wann ist eine Waffe schussbereit?");
    expect(byId.get("UmW-08")!.erw).toBe("Wenn sie geladen ist.");
    expect(byId.get("UmW-23")!.erw).toMatch(/Sehen aus wie echte Schusswaffen/);
    expect(byId.get("StGB-58")!.frage).toBe("Was ist Verh\u00e4ltnism\u00e4\u00dfigkeit (im Einsatzverhalten)?");
    expect(byId.get("StGB-35")!.frage).toBe("Was ist Notwehr\u00fcberschreitung (Notwehrexzess)?");
    expect(byId.get("RdOesO-15")!.frage).toBe("Welche Aufgabe hat die Polizei?");
  });

  it("uses the theme's existing source string, so no new source appears", () => {
    const sources = new Set(rows.map((r) => r.quelle));
    // Exactly the 9 pre-existing source values — the import introduced none.
    expect(sources.size).toBe(9);
    for (const id of IMPORTED) {
      expect(sources.has(byId.get(id)!.quelle), id).toBe(true);
    }
  });

  it("numbers the imported questions per theme without colliding on nr", () => {
    // Imported rows carry nr = null (they are not part of the numbered
    // Excel sequence); the numbered rows must still be collision-free.
    for (const id of IMPORTED) expect(byId.get(id)!.nr).toBeNull();
    const perTheme = new Map<string, number[]>();
    for (const r of rows) {
      if (r.nr === null) continue;
      const list = perTheme.get(r.thema) ?? [];
      list.push(r.nr);
      perTheme.set(r.thema, list);
    }
    for (const [theme, nrs] of perTheme) {
      expect(new Set(nrs).size, `duplicate nr in ${theme}`).toBe(nrs.length);
    }
  });

  it("does not touch the exam structure (13 questions, 9 themes, 100 points)", () => {
    // Guard against the import leaking into the exam logic.
    expect(ORAL_THEMES).toHaveLength(9);
    expect(ORAL_THEMES.reduce((s, t) => s + t.weight, 0)).toBe(100);
    expect(ORAL_THEMES.filter((t) => t.name === "Unfallverhuetungsvorschriften")).toHaveLength(1);
  });
});
