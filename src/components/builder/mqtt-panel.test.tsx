import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MqttPanel } from './MqttPanel';
import { appMqtt, resetAppMqtt } from '@/lib/mqtt/bus';

/**
 * The panel's interactive bits (publish form, clear) are covered by the
 * broker unit tests; here we pin the render contract — empty state, newest
 * first ordering, the retained marker, and the honesty note.
 */
describe('MqttPanel render', () => {
  it('shows the empty state and the honesty note on a fresh bus', () => {
    resetAppMqtt();
    const html = renderToString(<MqttPanel />);
    expect(html).toContain('No messages on the lab bus yet');
    expect(html).toContain('do not model a network stack');
  });

  it('lists messages newest first and marks retained ones', () => {
    resetAppMqtt();
    const broker = appMqtt();
    broker.publish('lab/temp', '21.5');
    broker.publish('lab/humi', '44', { retain: true });
    const html = renderToString(<MqttPanel />);
    // Newest first in the message table (the form's default topic also
    // contains 'lab/temp', so scope to the rows after the table opens).
    const table = html.slice(html.indexOf('<table'));
    expect(table.indexOf('lab/humi')).toBeLessThan(table.indexOf('lab/temp'));
    expect(html.indexOf('21.5')).toBeGreaterThan(-1);
    expect(html).toContain('retained');
  });

  it('reports dropped messages once the history bound is passed', () => {
    resetAppMqtt();
    const broker = appMqtt();
    for (let i = 0; i < 205; i += 1) broker.publish('t/x', String(i));
    const html = renderToString(<MqttPanel />);
    expect(html).toContain('older messages were dropped');
  });
});
