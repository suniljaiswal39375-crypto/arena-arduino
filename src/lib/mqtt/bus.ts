/**
 * The lab-wide in-app MQTT bus (spec §17.1 broker view).
 *
 * One bus per loaded page: the MQTT dock panel and any in-app publishers
 * share it. Headless scenario runs create their own broker instance via the
 * runner, so a CLI test never touches this singleton.
 */
import { MqttBroker } from './broker';

let bus: MqttBroker | null = null;

export function appMqtt(): MqttBroker {
  if (!bus) bus = new MqttBroker();
  return bus;
}

/** Tests only: swap in a fresh bus. */
export function resetAppMqtt(): void {
  bus = null;
}
