import type { LanguagePack, LookupError } from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { database } from "./database.ts";
import { loadZhPack } from "./dictionary.ts";
import { fetchDataFile, importData, type ImportFailure, type ImportProgress } from "./import.ts";
import { browserStorage, requestPersistence, type Persistence } from "./persistence.ts";
import { DEFAULT_REFERENTIAL, loadReferential, saveReferential } from "./referential.ts";

export type DataFailure = ImportFailure | LookupError;

export type DataState =
  | { readonly status: "importing"; readonly progress: ImportProgress }
  | { readonly status: "failed"; readonly failure: DataFailure }
  | { readonly status: "ready"; readonly pack: LanguagePack };

type ImportState =
  | { readonly status: "importing"; readonly progress: ImportProgress }
  | { readonly status: "failed"; readonly failure: ImportFailure }
  | { readonly status: "imported"; readonly progress: ImportProgress };

type DataContextValue = {
  readonly state: DataState;
  readonly persistence: Persistence | null;
  readonly retry: () => void;
  readonly referential: ZhProficiency;
  readonly referentialFailure: string | null;
  readonly chooseReferential: (referential: ZhProficiency) => void;
};

const DataContext = createContext<DataContextValue | null>(null);

export const useData = (): DataContextValue => {
  const value = use(DataContext);
  if (value === null) throw new Error("useData must be called under <DataProvider>");
  return value;
};

const storage = (): Storage => localStorage;
const START: ImportProgress = { rows: 0, total: 0 };

/** Imports the offline data once per attempt, then serves the zh pack of the chosen referential. */
export const DataProvider = ({ children }: { readonly children: ReactNode }) => {
  const [initial] = useState(() => loadReferential(storage));
  const [referential, setReferential] = useState<ZhProficiency>(
    initial.ok ? initial.value : DEFAULT_REFERENTIAL,
  );
  const [referentialFailure, setReferentialFailure] = useState(initial.ok ? null : initial.error);
  const [imported, setImported] = useState<ImportState>({ status: "importing", progress: START });
  const [pack, setPack] = useState<
    { readonly pack: LanguagePack } | { readonly failure: LookupError } | null
  >(null);
  const [persistence, setPersistence] = useState<Persistence | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);

  useEffect(() => {
    void requestPersistence(browserStorage()).then(setPersistence);
  }, []);

  useEffect(() => {
    // One import per attempt, even when StrictMode runs the effect twice.
    if (started.current === attempt) return;
    started.current = attempt;
    setImported({ status: "importing", progress: START });
    void importData(database, fetchDataFile, (progress) => {
      setImported({ status: "importing", progress });
    }).then((result) => {
      setImported((previous) =>
        result.ok
          ? {
              status: "imported",
              progress: previous.status === "failed" ? START : previous.progress,
            }
          : { status: "failed", failure: result.error },
      );
    });
  }, [attempt]);

  useEffect(() => {
    if (imported.status !== "imported") return;
    let active = true;
    void loadZhPack(database, referential).then((result) => {
      if (active) setPack(result.ok ? { pack: result.value } : { failure: result.error });
    });
    return () => {
      active = false;
    };
  }, [imported.status, referential]);

  const state: DataState =
    imported.status === "failed"
      ? { status: "failed", failure: imported.failure }
      : imported.status === "importing" || pack === null
        ? { status: "importing", progress: imported.progress }
        : "failure" in pack
          ? { status: "failed", failure: pack.failure }
          : { status: "ready", pack: pack.pack };

  return (
    <DataContext
      value={{
        state,
        persistence,
        retry: () => {
          setPack(null);
          setAttempt((count) => count + 1);
        },
        referential,
        referentialFailure,
        chooseReferential: (next) => {
          setReferential(next);
          const saved = saveReferential(storage, next);
          setReferentialFailure(saved.ok ? null : saved.error);
        },
      }}
    >
      {children}
    </DataContext>
  );
};
