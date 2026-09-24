// Ultrasonic Parking Radar
const int trigPin = 9;
const int echoPin = 10;
const int buzzerPin = 8;
const int ledPin = 13;

long measureCm() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long duration = pulseIn(echoPin, HIGH);
  return duration * 0.034 / 2;      // 0.034 cm per microsecond, there and back
}

void setup() {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  pinMode(buzzerPin, OUTPUT);
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  long cm = measureCm();
  Serial.print(cm);
  Serial.println(" cm");

  if (cm > 0 && cm < 30) {
    digitalWrite(ledPin, HIGH);
    long gap = map(cm, 2, 30, 60, 600);   // closer means faster beeps
    digitalWrite(buzzerPin, HIGH);
    delay(gap);
    digitalWrite(buzzerPin, LOW);
    delay(gap);
  } else {
    digitalWrite(ledPin, LOW);
    digitalWrite(buzzerPin, LOW);
    delay(60);
  }
}
