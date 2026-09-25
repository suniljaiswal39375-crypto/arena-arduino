'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { appMqtt } from '@/lib/mqtt/bus';
import type { MqttMessage } from '@/lib/mqtt/broker';

/**
 * The in-app MQTT broker view (spec §17.1). Shows the lab bus's message log
 * and lets you publish to it. Honesty note shown in the panel: sketches do
 * not model a network stack yet, so nothing on the canvas talks to this bus
 * — it is exercised by `publish-mqtt` scenario steps and by you, here.
 */
export function MqttPanel() {
  const { t } = useI18n();
  const broker = appMqtt();
  const [version, setVersion] = useState(0);
  const [topic, setTopic] = useState('lab/temp');
  const [payload, setPayload] = useState('');
  const [retain, setRetain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => broker.listen(() => setVersion((v) => v + 1)), [broker]);

  const messages: readonly MqttMessage[] = broker.messages();

  const onPublish = (): void => {
    const result = broker.publish(topic, payload, { retain });
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    setPayload('');
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3" data-testid="mqtt-panel" data-mqtt-version={version}>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onPublish();
        }}
      >
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-dim)]">
          {t('mqttTopic')}
          <input
            className="mono w-44 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            aria-label={t('mqttTopic')}
          />
        </label>
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-[var(--color-text-dim)]">
          {t('mqttPayload')}
          <input
            className="mono min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            aria-label={t('mqttPayload')}
          />
        </label>
        <label className="flex items-center gap-1 text-[12px] text-[var(--color-text-dim)]">
          <input
            type="checkbox"
            checked={retain}
            onChange={(e) => setRetain(e.target.checked)}
          />
          {t('mqttRetain')}
        </label>
        <button type="submit" className="btn btn-sm">
          {t('mqttPublish')}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => broker.clear()}>
          {t('mqttClear')}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-[12px] text-[var(--color-fault)]">
          {t('mqttRefused', { reason: error })}
        </p>
      )}
      {broker.dropped > 0 && (
        <p className="text-[11.5px] text-[var(--color-warn)]">{t('mqttDropped', { count: broker.dropped })}</p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-[var(--color-border)]">
        {messages.length === 0 ? (
          <p className="p-3 text-[12.5px] text-[var(--color-text-faint)]">{t('mqttEmpty')}</p>
        ) : (
          <table className="mono w-full text-[11.5px]">
            <tbody>
              {Array.from(messages)
                .reverse()
                .map((m) => (
                  <tr key={m.seq} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="w-10 px-2 py-1 text-right text-[var(--color-text-faint)]">{m.seq}</td>
                    <td className="max-w-[160px] truncate px-2 py-1 text-[var(--color-accent)]">{m.topic}</td>
                    <td className="truncate px-2 py-1">{m.payload || ' '}</td>
                    <td className="w-16 px-2 py-1 text-[var(--color-text-faint)]">
                      {m.retain ? t('mqttRetained') : ''}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11.5px] text-[var(--color-text-faint)]">{t('mqttNote')}</p>
    </div>
  );
}
