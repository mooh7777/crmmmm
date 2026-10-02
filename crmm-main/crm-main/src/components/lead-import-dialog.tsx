"use client";

import {useActionState, useState} from "react";
import Image from "next/image";
import {useTranslations} from "next-intl";
import {Dialog} from "@/components/ui/dialog";
import {Icon} from "@/components/ui/icon";
import {useDelayedPending} from "@/components/ui/motion";
import {Input, Select, Table} from "@/components/ui/primitives";
import {importLeadRows, previewLeadFile, type LeadFilePreviewState, type LeadImportState} from "@/app/[locale]/actions";
import {leadColumns, suggestLeadColumnMapping, type ColumnMapping, type LeadColumn} from "@/lib/lead-intake/mapping";

const initialPreview: LeadFilePreviewState = {headers: [], rows: [], error: null};
const initialImport: LeadImportState = {created: 0, duplicates: 0, failed: 0, error: null};

export function LeadImportDialog({organizationId, locale}: {organizationId: string; locale: "ar" | "en"}) {
  const t = useTranslations("dashboard");
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({full_name: "", phone: "", email: "", source: "", property_interest: ""});
  const [mappingHeaders, setMappingHeaders] = useState("");
  const [preview, previewAction, previewPending] = useActionState(previewLeadFile, initialPreview);
  const [result, importAction, importPending] = useActionState(importLeadRows, initialImport);
  const showPreviewPending = useDelayedPending(previewPending);
  const showImportPending = useDelayedPending(importPending);
  const headersKey = preview.headers.join("\u0000");
  const suggestedMapping = suggestLeadColumnMapping(preview.headers);
  const currentMapping = mappingHeaders === headersKey ? mapping : suggestedMapping;

  const mappedRows = preview.rows.map((row) => {
    const value = (column: LeadColumn) => {
      const index = Number(currentMapping[column]);
      return currentMapping[column] && Number.isInteger(index) ? row[index]?.trim() ?? "" : "";
    };
    return {
      full_name: value("full_name"),
      phone: value("phone"),
      email: value("email"),
      source: value("source"),
      property_interest: value("property_interest"),
    };
  }).filter((row) => row.full_name || row.phone);

  const canImport = Boolean(currentMapping.full_name && currentMapping.phone && mappedRows.length);
  const errorMessages: Record<string, string> = {
    forbidden: t("importForbidden"),
    "missing-file": t("importMissingFile"),
    "file-too-large": t("importFileTooLarge"),
    "unsupported-file": t("importUnsupportedFile"),
    "empty-file": t("importEmptyFile"),
    "too-many-rows": t("importTooManyRows"),
    "invalid-file": t("importInvalidFile"),
    "invalid-rows": t("importInvalidRows"),
    "import-failed": t("importFailed"),
  };

  return (
    <>
      <button className="secondary-button compact-button" onClick={() => setOpen(true)} type="button">
        <Icon name="import" size={18} />{t("importLeads")}
      </button>
      <Dialog
        closeLabel={t("closeDialog")}
        description={t("importDescription")}
        onOpenChange={setOpen}
        open={open}
        title={t("importTitle")}
      >
        <form action={previewAction} className="import-file-form">
          <input name="organizationId" type="hidden" value={organizationId} />
          <input name="locale" type="hidden" value={locale} />
          <label htmlFor="lead-import-file">{t("importFileLabel")}</label>
          <Input
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            id="lead-import-file"
            name="file"
            onChange={(event) => setSelectedFile(event.currentTarget.files?.[0] ?? null)}
            required
            type="file"
          />
          {selectedFile && <p className="import-file-name" dir="ltr">{selectedFile.name}</p>}
          <button className="secondary-button import-preview-button" disabled={previewPending} type="submit">
            {showPreviewPending ? <span aria-hidden="true" className="motion-spinner" /> : <Icon name="import" size={18} />}
            {showPreviewPending ? t("importReading") : t("importPreview")}
          </button>
        </form>

        {preview.error && <p className="form-alert" role="alert">{errorMessages[preview.error] ?? t("importFailed")}</p>}

        {preview.headers.length > 0 && (
          <>
            <div className="import-summary"><strong>{t("importRows", {count: mappedRows.length})}</strong><span>{t("importMappingTitle")}</span></div>
            <div className="import-mapping-grid">
              {leadColumns.map((column) => (
                <div className="field-stack" key={column.key}>
                  <label htmlFor={`mapping-${column.key}`}>{t(column.message)}{column.required ? ` · ${t("required")}` : ""}</label>
                  <Select
                    id={`mapping-${column.key}`}
                    onChange={(event) => {
                      const current = mappingHeaders === headersKey ? mapping : suggestedMapping;
                      setMapping({...current, [column.key]: event.currentTarget.value});
                      setMappingHeaders(headersKey);
                    }}
                    value={currentMapping[column.key]}
                  >
                    <option value="">{t("importSkipColumn")}</option>
                    {preview.headers.map((header, index) => (
                      <option key={`${index}-${header}`} value={String(index)}>{header || t("importUnnamedColumn", {number: index + 1})}</option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>

            <div className="import-preview-table">
              <Table className="data-table">
                <thead><tr>{leadColumns.slice(0, 3).map((column) => <th key={column.key}>{t(column.message)}</th>)}</tr></thead>
                <tbody>{preview.rows.slice(0, 4).map((row, rowIndex) => (
                  <tr key={rowIndex}>{leadColumns.slice(0, 3).map((column) => {
                    const index = Number(currentMapping[column.key]);
                    return <td key={column.key}>{currentMapping[column.key] ? row[index] || "—" : "—"}</td>;
                  })}</tr>
                ))}</tbody>
              </Table>
            </div>

            {result.error && <p className="form-alert" role="alert">{errorMessages[result.error] ?? t("importFailed")}</p>}
            {result.error === null && result.created + result.duplicates + result.failed > 0 && (
              <section aria-live="polite" className="import-success-state" role="status">
                <Image alt="" height={120} src="/illustrations/onboarding-import.svg" width={160} />
                <div><strong>{t("importSuccessTitle")}</strong><p>{t("importResult", {created: result.created, duplicates: result.duplicates, failed: result.failed})}</p></div>
                <Icon name="success" size={22} />
              </section>
            )}
            <form action={importAction} className="import-submit-form">
              <input name="organizationId" type="hidden" value={organizationId} />
              <input name="locale" type="hidden" value={locale} />
              <input name="rowsPayload" type="hidden" value={JSON.stringify(mappedRows)} />
              <button className="primary-button" disabled={!canImport || importPending} type="submit">
                {showImportPending && <span aria-hidden="true" className="motion-spinner" />}
                {t("importSubmit", {count: mappedRows.length})}
              </button>
            </form>
          </>
        )}
      </Dialog>
    </>
  );
}