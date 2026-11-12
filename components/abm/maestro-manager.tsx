"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, Card, CardContent, CardHeader, CardTitle, InlineMessage, useToast } from "@/components/ui";
import { editableFields, formatForDisplay, formatForInput, type FieldErrors, type RawValues } from "@/lib/abm/fields";
import { MAESTRO_SPECS, SIN_ESTADO, sociosSumWarning, validateMaestro, type MaestroSlug } from "@/lib/abm/maestros";
import type { AbmData, RecordDTO } from "@/lib/abm/types";

import { callApi } from "./api";
import { FieldInput } from "./field-input";
import { RecordTable, type Column, type Filter } from "./record-table";

type Editing = { mode: "create" } | { mode: "edit"; record: RecordDTO };

/**
 * ABM de un Maestro, armado a partir de su spec (lib/abm/maestros.ts):
 * lista con búsqueda/filtro por Estado, alta, edición y borrado (si la tabla
 * lo permite y el registro no tiene referencias). El servidor vuelve a validar todo.
 */
export function MaestroManager({ slug, data }: { slug: MaestroSlug; data: AbmData }) {
  const spec = MAESTRO_SPECS[slug];
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [raw, setRaw] = useState<RawValues>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fieldByKey = Object.fromEntries(spec.fields.map((f) => [f.key, f]));
  const display = (r: RecordDTO, key: string) => {
    const f = fieldByKey[key];
    const v = r.values[key];
    if (key === spec.estadoKey && (v === null || v === undefined || v === "")) return SIN_ESTADO;
    return f ? formatForDisplay(f, v, data.labels[key]) : String(v ?? "");
  };

  const columns: Column[] = spec.columns.map((key) => ({
    key,
    label: fieldByKey[key]?.label ?? key,
    text: (r) => display(r, key),
    numeric: ["number", "integer", "percent"].includes(fieldByKey[key]?.kind ?? ""),
  }));

  const filters: Filter[] = spec.estadoKey
    ? [
        {
          key: spec.estadoKey,
          label: "Estado",
          options: [
            ...(fieldByKey[spec.estadoKey]?.options ?? []),
            ...(data.records.some((r) => !r.values[spec.estadoKey!]) ? [SIN_ESTADO] : []),
          ],
          value: (r) => display(r, spec.estadoKey!),
        },
      ]
    : [];

  const warning = slug === "socios" ? sociosSumWarning(data.records.map((r) => r.values.porcentajeRetiros as number | null)) : null;

  function open(target: Editing) {
    setEditing(target);
    setErrors({});
    setFormError(null);
    setConfirmDelete(false);
    const initial: RawValues = {};
    for (const f of spec.fields) initial[f.key] = target.mode === "edit" ? formatForInput(f, target.record.values[f.key]) : f.kind === "checkbox" ? false : f.kind === "link" ? [] : "";
    setRaw(initial);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function close() {
    setEditing(null);
    setRaw({});
    setErrors({});
    setFormError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    // Mismas reglas que el servidor, para avisar antes de enviar.
    const local = validateMaestro(spec, raw, editing.mode);
    if (Object.keys(local.errors).length > 0) {
      setErrors(local.errors);
      setFormError("Revisá los campos marcados.");
      return;
    }
    setSaving(true);
    const body = Object.fromEntries(editableFields(spec.fields, editing.mode).map((f) => [f.key, raw[f.key]]));
    const res =
      editing.mode === "create"
        ? await callApi("POST", `/api/admin/maestros/${slug}`, body)
        : await callApi("PATCH", `/api/admin/maestros/${slug}/${editing.record.id}`, body);
    setSaving(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      setFormError(res.error ?? "Ocurrió un error. Probá de nuevo.");
      return;
    }
    toast.success(editing.mode === "create" ? "Registro creado." : "Cambios guardados.");
    close();
    router.refresh();
  }

  async function remove() {
    if (editing?.mode !== "edit") return;
    setSaving(true);
    const res = await callApi("DELETE", `/api/admin/maestros/${slug}/${editing.record.id}`);
    setSaving(false);
    setConfirmDelete(false);
    if (!res.ok) {
      setFormError(res.error ?? "No se pudo borrar.");
      return;
    }
    toast.success("Registro borrado.");
    close();
    router.refresh();
  }

  const title = editing?.mode === "edit" ? display(editing.record, spec.primaryKey) || "Editar" : spec.newLabel;
  const canDelete = spec.deletable && editing?.mode === "edit";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{spec.title}</h1>
        {!editing && (
          <Button onClick={() => open({ mode: "create" })}>
            <Plus aria-hidden="true" className="size-4" />
            {spec.newLabel}
          </Button>
        )}
      </header>

      {warning && <InlineMessage tone="info">{warning}</InlineMessage>}

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} noValidate className="flex flex-col gap-5">
              {formError && <InlineMessage tone="danger">{formError}</InlineMessage>}
              <div className="grid gap-4 md:grid-cols-2">
                {spec.fields
                  .filter((f) => !f.hideInForm && (f.kind !== "readonly" || editing.mode === "edit"))
                  .map((f) => (
                    <div key={f.key} className={f.kind === "multiline" || (f.kind === "link" && f.multiple) ? "md:col-span-2" : undefined}>
                      <FieldInput
                        spec={f}
                        value={raw[f.key]}
                        onChange={(v) => setRaw((prev) => ({ ...prev, [f.key]: v }))}
                        error={errors[f.key]}
                        options={data.options[f.key]}
                        labels={data.labels[f.key]}
                        disabled={saving || (editing.mode === "edit" && f.lockedOnEdit)}
                        display={editing.mode === "edit" ? display(editing.record, f.key) : undefined}
                      />
                    </div>
                  ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Guardando…" : "Guardar"}
                </Button>
                <Button variant="secondary" onClick={close} disabled={saving}>
                  Cancelar
                </Button>
                {canDelete && (
                  <div className="ml-auto flex items-center gap-2">
                    {confirmDelete ? (
                      <>
                        <span className="text-sm text-muted">¿Seguro que querés borrarlo?</span>
                        <Button variant="secondary" size="sm" onClick={remove} disabled={saving} className="text-danger">
                          Sí, borrar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={saving}>
                          No
                        </Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} disabled={saving}>
                        Borrar
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <RecordTable
        records={data.records}
        columns={columns}
        filters={filters}
        sortBy={(r) => (spec.primaryNumeric ? Number(r.values[spec.primaryKey] ?? 0) : display(r, spec.primaryKey))}
        onEdit={(r) => open({ mode: "edit", record: r })}
        rowLabel={(r) => display(r, spec.primaryKey)}
      />
    </div>
  );
}
