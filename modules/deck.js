const _symbols = [
    {
        "shape": "Heart",
        "icon": "♥",
        "color": "#ff0000"
    },
    {
        "shape": "Diamond",
        "icon": "♦",
        "color": "#ff0000"
    },
    {
        "shape": "Spade",
        "icon": "♠",
        "color": "#000"
    },
    {
        "shape": "Club",
        "icon": "♣",
        "color": "#000"
    }
]

const _numbers = [
    "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"
]

var generateDeck = function () {
    var cards = []
    _numbers.forEach(n => {
        _symbols.forEach(s => {
            cards.push({
                "number": n,
                "symbol": s
            })
        })
    })

    return cards;
}

// var _deck = generateDeck()

module.exports = generateDeck();
