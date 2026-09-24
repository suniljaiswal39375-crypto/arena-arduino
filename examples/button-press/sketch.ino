const int buttonPin = 2;
const int ledPin = 13;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
}

void loop() {
  // Pressed reads LOW because INPUT_PULLUP holds the pin HIGH.
  digitalWrite(ledPin, digitalRead(buttonPin) == LOW ? HIGH : LOW);
}
