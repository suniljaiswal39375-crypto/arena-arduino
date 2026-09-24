// Smart Streetlight: the lamp decides for itself.
const int ldrPin = A0;
const int relayPin = 8;
const int threshold = 400;   // below this it counts as dark

void setup() {
  pinMode(relayPin, OUTPUT);
  digitalWrite(relayPin, HIGH);   // relay boards are active LOW: HIGH is off
  Serial.begin(9600);
}

void loop() {
  int light = analogRead(ldrPin);
  Serial.println(light);

  if (light < threshold) {
    digitalWrite(relayPin, LOW);    // dark: switch the lamp on
  } else {
    digitalWrite(relayPin, HIGH);   // light: switch it off
  }
  delay(200);
}
