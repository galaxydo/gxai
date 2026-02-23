const jokes: string[] = [
    "Why don't scientists trust atoms? Because they make up everything!",
    "What do you call a fish with no eyes? Fsh!",
    "How do you organize a space party? You 'planet'!",
    "Why did the scarecrow win an award? Because he was outstanding in his field!",
    "I told my wife she was drawing her eyebrows too high. She looked surprised."
];

const randomJoke = jokes[Math.floor(Math.random() * jokes.length)];
console.log(randomJoke);