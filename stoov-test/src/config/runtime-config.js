export async function loadMqttConfig() {
  const response = await fetch("/api/stoov/mqtt-config");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
