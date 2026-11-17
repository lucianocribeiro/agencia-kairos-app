"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { aniosMesAFacturar, MESES, partesMes, unirMes } from "@/lib/horas/rules";
import { Select } from "./select";

/**
 * Mes + Año en dos selects (es-AR, en todos los navegadores, Safari incluido), en lugar de
 * `<input type="month">`. El valor es siempre "AAAA-MM" (o "" sin valor), igual que el input
 * nativo, así que lo que se manda o se pone en la URL no cambia (CC-F4-07).
 * Años 2000–2099 más el año guardado si quedó fuera (`aniosMesAFacturar`).
 */

export const MES_OPTIONS = MESES.map((label, i) => ({ value: String(i + 1).padStart(2, "0"), label }));

export const MES_ANIO_MESSAGES = {
  incompleto: "Completá mes y año.",
  incompletoFilas: "Completá mes y año en las filas marcadas.",
} as const;

export interface MesAnioPartes {
  mes: string;
  anio: string;
}

/** "vacio" (los dos vacíos), "incompleto" (uno solo) o "completo". */
export function estadoMesAnio({ mes, anio }: MesAnioPartes): "vacio" | "incompleto" | "completo" {
  if (mes && anio) return "completo";
  return mes || anio ? "incompleto" : "vacio";
}

interface MesAnioSelectProps extends MesAnioPartes {
  /** Nombre accesible: «<label>: mes» y «<label>: año». */
  label: string;
  onChange: (partes: MesAnioPartes) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** id del select de Mes (si no, el del FormField que lo envuelve). */
  id?: string;
  anioId?: string;
  className?: string;
}

/** Los dos selects, controlados por partes (el padre guarda mes y año por separado). */
export function MesAnioSelect({ label, mes, anio, onChange, disabled, invalid, id, anioId, className }: MesAnioSelectProps) {
  const inv = invalid ? true : undefined;
  return (
    <div className={cn("grid grid-cols-[minmax(7.5rem,3fr)_minmax(6rem,2fr)] gap-2", className)}>
      <Select
        id={id}
        value={mes}
        onChange={(e) => onChange({ mes: e.target.value, anio })}
        placeholder="Mes"
        options={MES_OPTIONS}
        disabled={disabled}
        aria-label={`${label}: mes`}
        {...(inv ? { "aria-invalid": inv } : {})}
      />
      <Select
        id={anioId}
        value={anio}
        onChange={(e) => onChange({ mes, anio: e.target.value })}
        placeholder="Año"
        options={aniosMesAFacturar(anio).map((y) => ({ value: y, label: y }))}
        disabled={disabled}
        aria-label={`${label}: año`}
        {...(inv ? { "aria-invalid": inv } : {})}
      />
    </div>
  );
}

interface MesAnioInputProps {
  label: string;
  /**
   * Valor "AAAA-MM" o "" (controlado). `null` = el padre sabe que está incompleto: se conservan
   * las partes que eligió el usuario. Si cambia desde afuera (p. ej. limpiar filtros), se resincroniza.
   */
  value?: string | null;
  /** Sin `value`: valor inicial (formularios GET). */
  defaultValue?: string;
  /** "AAAA-MM", "" (los dos vacíos) o null (uno solo elegido: no hay valor que aplicar). */
  onChange?: (value: string | null) => void;
  /** Formulario GET: input oculto con este name y el valor "AAAA-MM" (el mismo query string que el input nativo). */
  name?: string;
  /** Obligatorio: vacío o incompleto bloquea el envío del formulario que lo contiene. */
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * Mes + Año con valor "AAAA-MM": filtros, edición opcional y formularios GET. Con uno solo de los
 * dos elegido muestra «Completá mes y año.» y no informa un valor parcial (`onChange(null)`).
 */
export function MesAnioInput({ label, value, defaultValue = "", onChange, name, required, disabled, id, className }: MesAnioInputProps) {
  const inicial = typeof value === "string" ? value : defaultValue;
  const [partes, setPartes] = useState<MesAnioPartes>(() => {
    const p = partesMes(inicial);
    return { mes: p.mes, anio: p.anio };
  });
  const [synced, setSynced] = useState(inicial);
  const [touched, setTouched] = useState(false);
  // Ajuste de estado por cambio de prop (patrón de React): un valor nuevo desde afuera reemplaza las partes.
  if (typeof value === "string" && value !== synced) {
    const p = partesMes(value);
    setSynced(value);
    setPartes({ mes: p.mes, anio: p.anio });
    setTouched(false);
  }

  const estado = estadoMesAnio(partes);
  const bloquea = estado === "incompleto" || (required === true && estado === "vacio");
  const error = touched && bloquea ? MES_ANIO_MESSAGES.incompleto : null;

  // Formulario GET: no se envía con el mes incompleto (ni vacío si es obligatorio).
  const hidden = useRef<HTMLInputElement>(null);
  const bloqueaRef = useRef(bloquea);
  useEffect(() => {
    bloqueaRef.current = bloquea;
  }, [bloquea]);
  useEffect(() => {
    const form = hidden.current?.form;
    if (!form) return;
    const onSubmit = (e: SubmitEvent) => {
      if (!bloqueaRef.current) return;
      e.preventDefault();
      setTouched(true);
    };
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, []);

  function cambiar(next: MesAnioPartes) {
    setPartes(next);
    setTouched(true);
    const e = estadoMesAnio(next);
    const v = e === "completo" ? unirMes(next.anio, next.mes) : e === "vacio" ? "" : null;
    if (v !== null) setSynced(v);
    onChange?.(v);
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <MesAnioSelect label={label} mes={partes.mes} anio={partes.anio} onChange={cambiar} disabled={disabled} invalid={error !== null} id={id} />
      {name !== undefined && <input ref={hidden} type="hidden" name={name} value={estado === "completo" ? unirMes(partes.anio, partes.mes) : ""} />}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
