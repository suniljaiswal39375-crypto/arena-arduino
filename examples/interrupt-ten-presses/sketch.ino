// Interrupt-Driven Event Counter
const int buttonPin = 2;
const int ledPin = 13;

volatile int count = 0;

void onPress() {
  count = count + 1;      // handlers must be quick: just count
}

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
  attachInterrupt(digitalPinToInterrupt(buttonPin), onPress, FALLING);
  Serial.begin(9600);
}

void loop() {
  if (count > 0 && count % 10 == 0) {
    digitalWrite(ledPin, HIGH);
    Serial.print("reached ");
    Serial.println(count);
    delay(300);
    digitalWrite(ledPin, LOW);
    count = count + 1;    // so the message fires once per ten
  }
}
