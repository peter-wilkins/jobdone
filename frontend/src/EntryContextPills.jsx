import { PhotoAttachmentThumb } from './PhotoAttachmentControls';

function first(values) {
  return Array.isArray(values) && values.length > 0 ? values[0] : null;
}

function label(value, fields) {
  for (const field of fields) {
    const text = String(value?.[field] || '').trim();
    if (text) return text;
  }
  return '';
}

function Pill({ children, className }) {
  return (
    <span className={`inline-flex max-w-full items-center rounded px-2 py-0.5 text-xs font-medium ${className}`}>
      <span className="truncate">{children}</span>
    </span>
  );
}

export function EntryContextPills({
  entry,
  showPhotos = false,
  className = 'mt-2',
} = {}) {
  const primaryLocation = first(entry?.locations);
  const primaryContact = first(entry?.contacts);
  const tags = Array.isArray(entry?.tags) ? entry.tags : [];
  const workContexts = Array.isArray(entry?.workContexts) ? entry.workContexts : [];
  const photoAttachments = showPhotos
    ? (entry?.attachments || []).filter(attachment => attachment.kind === 'photo' && attachment.status === 'ready')
    : [];

  const locationLabel = label(primaryLocation, ['displayName', 'placeText', 'addressText', 'label']);
  const contactLabel = label(primaryContact, ['displayName', 'label', 'primaryEmail', 'primaryPhone']);

  if (!locationLabel && !contactLabel && tags.length === 0 && workContexts.length === 0 && photoAttachments.length === 0) {
    return null;
  }

  return (
    <div className={`${className} flex flex-wrap gap-1.5`}>
      {locationLabel && (
        <Pill className="bg-emerald-50 text-emerald-700">{locationLabel}</Pill>
      )}
      {contactLabel && (
        <Pill className="bg-violet-50 text-violet-700">{contactLabel}</Pill>
      )}
      {workContexts.map(context => {
        const contextLabel = label(context, ['label', 'description', 'title']);
        if (!contextLabel) return null;
        return (
          <Pill key={context.id || contextLabel} className="bg-amber-50 text-amber-800">{contextLabel}</Pill>
        );
      })}
      {tags.map(tag => {
        const tagLabel = label(tag, ['label', 'name']);
        if (!tagLabel) return null;
        return (
          <Pill key={tag.id || tagLabel} className="bg-sky-50 text-sky-700">{tagLabel}</Pill>
        );
      })}
      {photoAttachments.length > 0 && (
        <div className="mt-0.5 flex basis-full gap-2 overflow-x-auto pb-1">
          {photoAttachments.map(attachment => (
            <PhotoAttachmentThumb key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}
    </div>
  );
}
