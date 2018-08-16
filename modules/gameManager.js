const Deck = require('./deck')

module.exports = {
    deck: '',
    id: '',
    players: [],
    table: [],
    round: -1,

    newGame: function () {
        this.deck = JSON.parse(JSON.stringify(Deck))
        this.players = [];
        this.table = [];
        this.round = -1;
        this.id = this.generateId()

        return this;
    },

    joinPlayer: function(id){
        console.log(id + " is waiting");
        this.players.push(id)
    },

    removePlayer: function(id){
        console.log(id + " is leaving");

        var idx = this.players.indexOf(id);

        if(idx > -1)
            this.players.splice(idx,1);
    },

    drawCard: function (number, id) {
        var forPlayer = id ? true : false;
        var cards = [];

        if (!forPlayer && this.table.length == 5)
            return cards;

        if ((forPlayer && !this.playerHasCards(id)) || !forPlayer) {
            for (var i = 0; i < number; i++) {
                var rnd = Math.floor(Math.random() * this.deck.length)

                cards.push(this.deck[rnd])
                this.deck.splice(rnd, 1);
            }
        }

        if (forPlayer) {
            this.players.push({
                "id": id,
                "cards": cards
            })
        } else {
            this.round++;

            if (this.round == 1)
                this.table = JSON.parse(JSON.stringify(cards));
            else
                this.table.push(cards[0])
        }

        return cards;
    },

    playerHasCards: function (id) {
        for (var i = 0; i < this.players.length; i++) {
            if (this.players[i].id == id && this.players[i].cards.length > 0)
                return true;
        }

        return false;
    },

    generateId: function(){
        return '_' + Math.random().toString(36).substr(2, 9);  
    }
}