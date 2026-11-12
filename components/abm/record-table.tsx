"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, Input, Select, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableRow } from "@/components/ui";
import type { RecordDTO } from "@/lib/abm/types";

export interface Column {
  key: string;
  label: string;
  /** Texto de la celda (también se usa para buscar). */
  text: (record: RecordDTO) => string;
  numeric?: boolean;
}

export interface Filter {
  key: string;
  label: string;
  options: readonly string[];
  value: (record: RecordDTO) => string;
}

interface RecordTableProps {
  records: RecordDTO[];
  columns: Column[];
  /** Orden por el campo principal. */
  sortBy: (record: RecordDTO) => string | number;
  filters?: Filter[];
  onEdit: (record: RecordDTO) => void;
  /** Para el texto del botón por fila, p. ej. "Editar Acme". */
  rowLabel: (record: RecordDTO) => string;
}

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Lista con búsqueda de texto, filtros por select y orden por el campo principal. Sin límite de filas. */
export function RecordTable({ records, columns, sortBy, filters = [], onEdit, rowLabel }: RecordTableProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Record<string, string>>({});

  const rows = useMemo(() => {
    const q = normalize(query.trim());
    return records
      .filter((r) => filters.every((f) => !active[f.key] || f.value(r) === active[f.key]))
      .filter((r) => !q || columns.some((c) => normalize(c.text(r)).includes(q)))
      .sort((a, b) => {
        const x = sortBy(a);
        const y = sortBy(b);
        return typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
      });
  }, [records, columns, filters, active, query, sortBy]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="relative flex-1">
          <span className="sr-only">Buscar</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar…" className="pl-9" />
        </label>
        {filters.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 sm:w-48">
            <span className="text-xs text-muted">{f.label}</span>
            <Select
              value={active[f.key] ?? ""}
              onChange={(e) => setActive({ ...active, [f.key]: e.target.value })}
              placeholder="Todos"
              options={f.options.map((o) => ({ value: o, label: o }))}
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {rows.length === records.length ? `${records.length} registros` : `${rows.length} de ${records.length} registros`}
      </p>
      <Table>
        <TableHead>
          <tr>
            {columns.map((c) => (
              <TableHeaderCell key={c.key} className={c.numeric ? "text-right" : undefined}>
                {c.label}
              </TableHeaderCell>
            ))}
            <TableHeaderCell>
              <span className="sr-only">Acciones</span>
            </TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={columns.length + 1}>{records.length === 0 ? "Todavía no hay registros." : "No hay resultados con esos filtros."}</TableEmpty>
          ) : (
            rows.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => onEdit(r)}>
                {columns.map((c) => (
                  <TableCell key={c.key} numeric={c.numeric}>
                    {c.text(r) || <span className="text-muted">—</span>}
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Editar ${rowLabel(r)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(r);
                    }}
                  >
                    Editar
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
