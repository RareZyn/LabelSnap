// Re-crop a saved Entry from its retained original.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthed, useSession } from '../../stores/sessionStore';
import { replaceEntryImages, useEntries } from '../../data/entries';
import { getEntryBlob } from '../../lib/images';
import { detectStill } from '../../lib/imaging/imagingClient';
import type { Quad } from '../../data/types';
import { CropStep } from './CropStep';
import { Button, EmptyState, Spinner } from '../../components/ui';
import { toast } from '../../stores/toastStore';
import { useDriveStore } from '../../stores/driveStore';

export default function RecropPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { docId, entryId } = useParams();
  const { spaceId } = useAuthed();
  const prefs = useSession((s) => s.prefs);
  const drive = useDriveStore((s) => s.status);
  const { data: entries, loading } = useEntries(spaceId, docId);
  const entry = entries.find((e) => e.id === entryId);
  const [original, setOriginal] = useState<Blob | null | undefined>(undefined);
  const [detected, setDetected] = useState<Quad | null>(null);

  useEffect(() => {
    if (!entry || original !== undefined) return;
    void getEntryBlob(entry, 'original').then(async (b) => {
      setOriginal(b);
      if (b) setDetected(await detectStill(b));
    });
  }, [entry, original, drive]);

  const back = () => navigate(`/d/${docId}/e/${entryId}`);

  if (!entry) {
    return (
      <div className="capture center">
        {loading ? <Spinner label={t('common.loading')} /> : <EmptyState icon="image" title={t('entries.notFound')} />}
      </div>
    );
  }
  if (original === undefined) {
    return (
      <div className="capture center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  if (original === null) {
    return (
      <div className="capture center">
        <EmptyState
          icon="cloudOff"
          title={t('crop.originalMissing')}
          body={t('crop.originalMissingBody')}
          action={<Button onClick={back}>{t('common.back')}</Button>}
        />
      </div>
    );
  }

  return (
    <div className="capture">
      <CropStep
        source={original}
        detected={detected}
        initial={{
          quad: entry.cropQuad ?? undefined,
          rotation: entry.rotation,
          straighten: entry.straighten,
          filter: entry.filter,
          autoDetect: false,
        }}
        maxDim={2400}
        quality={prefs.compressionTarget}
        title={t('crop.recropTitle')}
        onBack={back}
        onUse={async (r) => {
          await replaceEntryImages(entry, {
            derived: r.derived,
            thumb: r.thumb,
            width: r.width,
            height: r.height,
            cropQuad: r.quad,
            rotation: r.rotation,
            straighten: r.straighten,
            filter: r.filter,
            qualityFlags: r.report.flags,
          });
          toast(t('crop.recropped'));
          navigate(`/d/${docId}/e/${entryId}?rerunOcr=1`, { replace: true });
        }}
        useLabel={t('crop.saveCrop')}
      />
    </div>
  );
}
