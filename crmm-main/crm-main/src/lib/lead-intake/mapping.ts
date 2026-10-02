export type LeadColumn = "full_name" | "phone" | "email" | "source" | "property_interest";
export type ColumnMapping = Record<LeadColumn, string>;

export const leadColumns: {key: LeadColumn; message: string; required: boolean}[] = [
  {key: "full_name", message: "importName", required: true},
  {key: "phone", message: "importPhone", required: true},
  {key: "email", message: "importEmail", required: false},
  {key: "source", message: "importSource", required: false},
  {key: "property_interest", message: "importProperty", required: false},
];

const aliases: Record<LeadColumn, string[]> = {
  full_name: ["name", "fullname", "leadname", "client", "customername", "الاسم", "اسمالعميل", "العميل", "الاسمالكامل"],
  phone: ["phone", "phonenumber", "mobilenumber", "mobile", "mobilephone", "telephone", "tel", "رقمالهاتف", "الهاتف", "رقمالجوال", "الجوال", "رقمالموبايل", "الموبايل", "المحمول", "تليفون"],
  email: ["email", "emailaddress", "e-mail", "البريد", "البريدالالكتروني", "البريدالإلكتروني"],
  source: ["source", "leadsource", "مصدر", "المصدر", "مصدرالعميل"],
  property_interest: ["property", "propertyinterest", "project", "area", "العقار", "المشروع", "المنطقة", "الاهتمام"],
};

export function normalizeLeadHeader(header: string) {
  return header
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function suggestLeadColumnMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeLeadHeader);
  const mapping = {} as ColumnMapping;
  const used = new Set<string>();

  for (const column of leadColumns) {
    const match = normalized.findIndex((header, index) =>
      !used.has(String(index)) && aliases[column.key].some((alias) => normalizeLeadHeader(alias) === header),
    );
    mapping[column.key] = match < 0 ? "" : String(match);
    if (match >= 0) used.add(String(match));
  }

  return mapping;
}