#include <DHT.h>

#define DHTPIN 2
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);
const int relayPin = 8;

const float heatOn = 24.0;    // switch the heater on below this
const float heatOff = 27.0;   // and off again above this

bool heating = false;

void setup() {
  pinMode(relayPin, OUTPUT);
  digitalWrite(relayPin, HIGH);   // active LOW relay: start off
  dht.begin();
  Serial.begin(9600);
}

void loop() {
  float t = dht.readTemperature();

  if (!heating && t < heatOn) heating = true;
  else if (heating && t > heatOff) heating = false;

  digitalWrite(relayPin, heating ? LOW : HIGH);
  Serial.println(t);
  delay(500);
}
