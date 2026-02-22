const jokes = [
  "Why did the web developer walk out of a restaurant? Because of the table layout.",
  "How many programmers does it take to change a light bulb? None, that's a hardware problem.",
  "A SQL query goes into a bar, walks up to two tables, and asks, 'Can I join you?'",
  "Why do programmers always mix up Halloween and Christmas? Because Oct 31 == Dec 25."
];

console.log("Hello from GXAI!");
console.log(new Date().toISOString());
const randomJoke = jokes[Math.floor(Math.random() * jokes.length)];
console.log(randomJoke);