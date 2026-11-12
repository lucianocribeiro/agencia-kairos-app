"use client";

import { KeyRound, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, Card, CardContent, CardHeader, CardTitle, FormField, InlineMessage, Input, useToast } from "@/components/ui";
import { formatForInput, type FieldErrors, type RawValues } from "@/lib/abm/fields";
import type { AbmData, RecordDTO } from "@/lib/abm/types";
import { USUARIO_FIELDS, validateTemporaryPassword, validateUsuario } from "@/lib/abm/usuarios";
import { generateTemporaryPassword } from "@/lib/auth/password-policy";
import { formatDateTime } from "@/lib/format";

import { callApi } from "./api";
import { FieldInput } from "./field-input";
import { RecordTable, type Column, type Filter } from "./record-table";

type Editing = { mode: "create" } | { mode: "edit"; record: RecordDTO };

/** Campo de contraseña temporal con "Generar". La contraseña se ve hasta guardar; nunca se loguea. */
function TemporaryPassword({ value, onChange, error, disabled }: { value: string; onChange: (v: string) => void; error?: string; disabled?: boolean }) {
  return (
    <FormField label="Contraseña temporal" required error={error} hint="Mínimo 10 caracteres, máximo 72 bytes. Compartila por un canal seguro: se le va a pedir cambiarla al entrar.">
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} disabled={disabled} className="font-mono" />
        <Button variant="secondary" onClick={() => onChange(generateTemporaryPassword())} disabled={disabled}>
          <KeyRound aria-hidden="true" className="size-4" />
          Generar
        </Button>
      </div>
    </FormField>
  );
}

export function UsuariosManager({ data, currentUserId }: { data: AbmData; currentUserId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [raw, setRaw] = useState<RawValues>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | undefined>();

  const columns: Column[] = [
    { key: "nombre", label: "Nombre", text: (r) => String(r.values.nombre ?? "") },
    { key: "email", label: "Email", text: (r) => String(r.values.email ?? "") },
    { key: "rol", label: "Rol", text: (r) => String(r.values.rol ?? "") },
    { key: "estado", label: "Estado", text: (r) => String(r.values.estado ?? "") },
    { key: "sigla", label: "Sigla", text: (r) => String(r.values.sigla ?? "") },
    { key: "ultimoAcceso", label: "Último acceso", text: (r) => formatDateTime(r.values.ultimoAcceso as string | null) },
    {
      key: "proyectos",
      label: "Proyectos",
      numeric: true,
      text: (r) => (r.values.rol === "Empleado" ? String((r.values.proyectosAsignados as string[]).length) : ""),
    },
  ];
  const filters: Filter[] = [
    { key: "rol", label: "Rol", options: ["Admin", "Empleado"], value: (r) => String(r.values.rol ?? "") },
    { key: "estado", label: "Estado", options: ["Activo", "Inactivo"], value: (r) => String(r.values.estado ?? "") },
  ];

  function open(target: Editing) {
    setEditing(target);
    setErrors({});
    setFormError(null);
    setResetOpen(false);
    setResetPassword("");
    setResetError(undefined);
    const initial: RawValues = {};
    for (const f of USUARIO_FIELDS) initial[f.key] = target.mode === "edit" ? formatForInput(f, target.record.values[f.key]) : f.kind === "link" ? [] : "";
    if (target.mode === "create") initial.password = "";
    setRaw(initial);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function close() {
    setEditing(null);
    setRaw({}); // descarta la contraseña temporal del estado
    setResetPassword("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const local = validateUsuario(raw, editing.mode);
    if (Object.keys(local.errors).length > 0) {
      setErrors(local.errors);
      setFormError("Revisá los campos marcados.");
      return;
    }
    setSaving(true);
    const keys = [...USUARIO_FIELDS.map((f) => f.key), ...(editing.mode === "create" ? ["password"] : [])];
    const body = Object.fromEntries(keys.map((k) => [k, raw[k]]));
    const res =
      editing.mode === "create"
        ? await callApi("POST", "/api/admin/usuarios", body)
        : await callApi("PATCH", `/api/admin/usuarios/${editing.record.id}`, body);
    setSaving(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      setFormError(res.error ?? "Ocurrió un error. Probá de nuevo.");
      return;
    }
    toast.success(editing.mode === "create" ? "Usuario creado. Va a tener que cambiar la contraseña al entrar." : "Cambios guardados.");
    close();
    router.refresh();
  }

  async function setActivo(record: RecordDTO, activo: boolean) {
    setSaving(true);
    const res = await callApi("POST", `/api/admin/usuarios/${record.id}/estado`, { activo });
    setSaving(false);
    if (!res.ok) {
      setFormError(res.error ?? "No se pudo cambiar el estado.");
      return;
    }
    toast.success(activo ? "Usuario activado." : "Usuario desactivado.");
    close();
    router.refresh();
  }

  async function submitReset(record: RecordDTO) {
    const problem = validateTemporaryPassword(resetPassword);
    if (problem) return setResetError(problem);
    setSaving(true);
    const res = await callApi("POST", `/api/admin/usuarios/${record.id}/password`, { password: resetPassword });
    setSaving(false);
    if (!res.ok) {
      setResetError(res.fieldErrors?.password ?? res.error);
      return;
    }
    toast.success("Contraseña reseteada. Las sesiones abiertas de ese usuario se cerraron.");
    close();
    router.refresh();
  }

  const isEmpleado = raw.rol === "Empleado";
  const record = editing?.mode === "edit" ? editing.record : null;
  const isSelf = record?.id === currentUserId;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Usuarios</h1>
        {!editing && (
          <Button onClick={() => open({ mode: "create" })}>
            <Plus aria-hidden="true" className="size-4" />
            Nuevo usuario
          </Button>
        )}
      </header>

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>{record ? String(record.values.nombre || "Editar usuario") : "Nuevo usuario"}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <form onSubmit={submit} noValidate className="flex flex-col gap-5">
              {formError && <InlineMessage tone="danger">{formError}</InlineMessage>}
              {record && (
                <p className="text-sm text-muted">
                  Estado: <span className="text-text">{String(record.values.estado ?? "")}</span>
                  {record.values.debeCambiarPassword === true && " · Debe cambiar la contraseña"}
                  {record.values.ultimoAcceso ? ` · Último acceso ${formatDateTime(record.values.ultimoAcceso as string)}` : ""}
                </p>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {USUARIO_FIELDS.filter((f) => f.key !== "proyectosAsignados" || isEmpleado).map((f) => (
                  <div key={f.key} className={f.key === "proyectosAsignados" ? "md:col-span-2" : undefined}>
                    <FieldInput
                      spec={f}
                      value={raw[f.key]}
                      onChange={(v) => setRaw((prev) => ({ ...prev, [f.key]: v }))}
                      error={errors[f.key]}
                      options={data.options[f.key]}
                      labels={data.labels[f.key]}
                      disabled={saving || (f.key === "rol" && isSelf)}
                    />
                  </div>
                ))}
                {editing.mode === "create" && (
                  <div className="md:col-span-2">
                    <TemporaryPassword
                      value={typeof raw.password === "string" ? raw.password : ""}
                      onChange={(v) => setRaw((prev) => ({ ...prev, password: v }))}
                      error={errors.password}
                      disabled={saving}
                    />
                  </div>
                )}
              </div>
              {record && raw.rol === "Admin" && (record.values.proyectosAsignados as string[]).length > 0 && (
                <p className="text-xs text-muted">Los proyectos asignados se conservan, pero no se usan mientras sea Admin.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Guardando…" : "Guardar"}
                </Button>
                <Button variant="secondary" onClick={close} disabled={saving}>
                  Cancelar
                </Button>
              </div>
            </form>

            {record && !isSelf && (
              <div className="flex flex-col gap-4 border-t border-line pt-5">
                <div className="flex flex-wrap gap-2">
                  {record.values.estado === "Activo" ? (
                    <Button variant="secondary" onClick={() => setActivo(record, false)} disabled={saving}>
                      Desactivar
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => setActivo(record, true)} disabled={saving}>
                      Activar
                    </Button>
                  )}
                  {!resetOpen && (
                    <Button variant="ghost" onClick={() => setResetOpen(true)} disabled={saving}>
                      Resetear contraseña
                    </Button>
                  )}
                </div>
                {resetOpen && (
                  <div className="flex flex-col gap-3">
                    <TemporaryPassword value={resetPassword} onChange={setResetPassword} error={resetError} disabled={saving} />
                    <div className="flex gap-2">
                      <Button onClick={() => submitReset(record)} disabled={saving}>
                        Guardar contraseña temporal
                      </Button>
                      <Button variant="ghost" onClick={() => setResetOpen(false)} disabled={saving}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <RecordTable
        records={data.records}
        columns={columns}
        filters={filters}
        sortBy={(r) => String(r.values.nombre ?? "")}
        onEdit={(r) => open({ mode: "edit", record: r })}
        rowLabel={(r) => String(r.values.nombre ?? "")}
      />
    </div>
  );
}
