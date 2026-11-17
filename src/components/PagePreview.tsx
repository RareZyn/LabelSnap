// HTML rendering of the layout engine: used by the Template live preview, the page-preview tab and print.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Entry, ImageVariant, TemplateSettings } from '../data/types';
import { computeLayout, fitContain, type Rect } from '../lib/templates/layout';
import { bandText, slotTexts } from '../lib/templates/render';
import { useEntryImage } from '../lib/images';
import { useFormat } from '../hooks/useFormat';

type PreviewEntry = Pick<Entry, 'id' | 'caption' | 'footnote' | 'width' | 'height' | 'originalImagePath' | 'imagePath' | 'thumbPath'>;

const FONT_CSS: Record<string, string> = {
  Helvetica: 'Helvetica, Arial, sans-serif',
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

function abs(r: Rect, s: number): CSSProperties {
  return { left: r.x * s, top: r.y * s, width: r.w * s, height: r.h * s };
}

function SlotImage({ entry, box, scale, variant }: { entry: PreviewEntry | null; box: Rect; scale: number; variant: ImageVariant }) {
  const { url } = useEntryImage(entry, variant);
  const fit = entry ? fitContain(box, entry.width || 4, entry.height || 3) : box;
  if (!url) return <div className="ps-img" style={abs(fit, scale)} aria-hidden="true" />;
  return <img className="ps-img" src={url} alt="" style={{ ...abs(fit, scale), background: 'none' }} />;
}

export function PagePreview({
  settings,
  entries,
  documentTitle,
  width,
  maxPages,
  variant = 'thumb',
  sample = false,
  print = false,
}: {
  settings: TemplateSettings;
  entries: PreviewEntry[];
  documentTitle: string;
  /** Target on-screen width of one page in CSS px. Ignored when printing. */
  width?: number;
  maxPages?: number;
  variant?: ImageVariant;
  /** Draw placeholder figures when there are no Entries (Template editor). */
  sample?: boolean;
  print?: boolean;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [autoWidth, setAutoWidth] = useState(360);

  useEffect(() => {
    if (width || print || !wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => setAutoWidth(Math.min(620, Math.max(220, el.clientWidth - 32))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, print]);

  const sampleEntries: PreviewEntry[] = sample && !entries.length
    ? Array.from({ length: settings.imagesPerPage }, (_, i) => ({
        id: `sample-${i}`,
        caption: t('templates.sampleCaption', { n: i + 1 }),
        footnote: i === 0 ? t('templates.sampleFootnote') : '',
        width: 4,
        height: 3,
        originalImagePath: '',
        imagePath: '',
        thumbPath: '',
      }))
    : entries;
  const isSample = sampleEntries !== entries;
  const layout = computeLayout(settings, sampleEntries.length, { minPages: 1 });
  const pages = maxPages ? layout.pages.slice(0, maxPages) : layout.pages;
  const scale = print ? 96 / 72 : (width ?? autoWidth) / layout.pageWidth;
  const texts = slotTexts(sampleEntries, settings.numberingScheme, {
    figure: t('numbering.figureWord'),
    fig: t('numbering.figWord'),
    plate: t('numbering.plateWord'),
    image: t('numbering.imageWord'),
  });
  const today = fmt.date(new Date());
  const capFont = FONT_CSS[settings.captionFont];
  const bodyFont = FONT_CSS[settings.bodyFont];

  return (
    <div ref={wrapRef} className={print ? 'page-pages' : 'page-preview-wrap'}>
      <div className="page-pages">
        {pages.map((page) => {
          const bandCtx = { document: documentTitle, page: page.index + 1, pages: layout.pages.length, date: today };
          return (
            <div
              key={page.index}
              className="page-sheet"
              style={{ width: layout.pageWidth * scale, height: layout.pageHeight * scale }}
              aria-label={t('preview.pageLabel', { page: page.index + 1, pages: layout.pages.length })}
              role="img"
            >
              {page.header && (
                <div
                  className="ps-abs"
                  style={{
                    ...abs(page.header, scale),
                    fontFamily: bodyFont,
                    fontSize: (settings.bodyFontSize - 1) * scale,
                    color: '#777',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {bandText(settings.headerText, bandCtx)}
                </div>
              )}
              {page.slots.map((slot) => {
                const entry = sampleEntries[slot.entryIndex];
                const text = texts[slot.entryIndex];
                if (!entry || !text) return null;
                const below = settings.captionPosition !== 'above';
                return (
                  <div key={entry.id}>
                    <SlotImage entry={isSample ? null : entry} box={slot.image} scale={scale} variant={variant} />
                    <div
                      className="ps-abs"
                      style={{
                        ...abs(slot.caption, scale),
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: below || settings.captionPosition === 'right' ? 'flex-start' : 'flex-end',
                        gap: 2 * scale,
                      }}
                    >
                      <div style={{ fontFamily: capFont, fontSize: settings.captionFontSize * scale, fontWeight: 600, lineHeight: 1.25 }}>
                        {text.line}
                        {text.footnoteNo && <sup>{text.footnoteNo}</sup>}
                      </div>
                      {text.footnote && (
                        <div style={{ fontFamily: bodyFont, fontSize: settings.bodyFontSize * scale, color: '#666', lineHeight: 1.25 }}>
                          <sup>{text.footnoteNo}</sup> {text.footnote}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {page.footer && (
                <div
                  className="ps-abs"
                  style={{
                    ...abs(page.footer, scale),
                    fontFamily: bodyFont,
                    fontSize: (settings.bodyFontSize - 1) * scale,
                    color: '#777',
                    textAlign: 'center',
                  }}
                >
                  {bandText(settings.footerText, bandCtx)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
