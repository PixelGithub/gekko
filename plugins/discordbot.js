var log = require('../core/log');
var moment = require('moment');
var _ = require('lodash');
var config = require('../core/util').getConfig();
var discordbot = config.discordbot;
var utc = moment.utc;
const stats = require('../core/stats');
const perfConfig = config.performanceAnalyzer;

var discord = require("discord.io");

var Actor = function() {
  _.bindAll(this);

  this.bot = new discord.Client({
    token: discordbot.token,
    autorun: true
  });
  console.log("this should appear only once");

  this.dates = {
    start: false,
    end: false
  }
  this.currency = config.watch.currency;
  this.asset = config.watch.asset;
  this.trades = 0;

  this.sharpe = 0;

  this.roundTrips = [];
  this.roundTrip = {
    entry: false,
    exit: false
  }

  this.bot.addListener("message", this.verifyQuestion);
  this.bot.addListener("error", this.logError);
  this.bot.addListener("disconnect", this.autoReconnect);



  this.advice = 'Dont got one yet :(';
  this.adviceTime = utc();

  this.price = 'Dont know yet :(';
  this.priceTime = utc();

  this.commands = {
    '!advice': 'emitAdvice',
    '!price': 'emitPrice',
    '!donate': 'emitDonation',
    '!balance': 'emitPortfolioReport',
    '!trades': 'emitRoundTrips',
    '!real advice': 'emitRealAdvice',
    '!help': 'emitHelp'
  };

  this.rawCommands = _.keys(this.commands);
}

Actor.prototype.processCandle = function(candle, done) {
  this.price = candle.close;
  this.dates.end = candle.start;

  if(!this.dates.start) {
    this.dates.start = candle.start;
    this.startPrice = candle.close;
  }

  this.endPrice = candle.close;

  done();
};

Actor.prototype.portfolioUpdate = function(portfolio) {
  console.log("portfolioUpdate");
  this.start = portfolio;
  this.current = _.clone(portfolio);
  message = "we have " +this.start.balance+this.currency;
  this.bot.sendMessage({
                    to: discordbot.channel,
                    message: message
                });

}

Actor.prototype.processPortfolioUpdate = function(portfolio) {
  console.log("processPortfolioUpdate");
  this.start = portfolio;
  this.current = _.clone(portfolio);
  message = "we have " +this.current.balance+this.currency;
  console.log(message);
  this.bot.sendMessage({
                    to: discordbot.channel,
                    message: message
                });
                console.log(discordbot.channel);

}

Actor.prototype.round = function(amount) {
  return amount.toFixed(8);
}

Actor.prototype.emitPortfolioReport = function() {
  let balance = this.current.currency + this.price * this.current.asset;
  let profit = balance - this.start.balance;
  //let's make a nice embed for portfolio exitBalance
  portfolioEmbed = {
  "embed": {
    "title": "Balance",
    "description": "```"+balance.toFixed(2)+" "+this.currency+"```",
    "color": 16744448,
    "timestamp": moment().format(),
    "footer": {
      "text": "PixelBot © 2018 - Made by @PixelCrunch#5462"
    },
    "author": {
      "name": "Portfolio Report",
      "icon_url": "https://twemoji.maxcdn.com/2/72x72/1f4b0.png"
    },
    "fields": [
      {
        "name": "Starting Balance",
        "value": "```"+this.start.balance.toFixed(2)+" "+this.currency+"```"
      },{
        "name": "Profit",
        "value": "```"+profit.toFixed(2)+" "+this.currency+"```"
      },{
        "name": "Asset",
        "value": "```"+this.current.asset+" "+this.asset+" ("+(this.price * this.current.asset).toFixed(2)+" "+this.currency+")```",
        "inline": true
      },
      {
        "name": "Currency",
        "value": "```"+this.current.currency.toFixed(2)+" "+this.currency+"```",
        "inline": true
      }
    ]
  }
}


  //this.handler.handleTrade(trade, report);
  //message = "we have " +this.current.currency+this.currency;
  console.log("Sending Portfolio");
  this.bot.sendMessage({
                    to: discordbot.channel,
                    embed: portfolioEmbed.embed
                });
                //console.log(discordbot.channel);

}

Actor.prototype.processTrade = function(trade) {
  this.trades++;
  this.current = trade.portfolio;
  this.logRoundtripPart(trade);
}

Actor.prototype.logRoundtripPart = function(trade) {
  // this is not part of a valid roundtrip
  if(this.trades === 1 && trade.action === 'sell') {
    return;
  }

  if(trade.action === 'buy') {
    this.roundTrip.entry = {
      date: trade.date,
      price: trade.price,
      total: trade.portfolio.asset * trade.price,
    }
  } else if(trade.action === 'sell') {
    this.roundTrip.exit = {
      date: trade.date,
      price: trade.price,
      total: trade.portfolio.currency
    }

    this.handleRoundtrip();
  }
}

Actor.prototype.handleRoundtrip = function() {
  var roundtrip = {
    entryAt: this.roundTrip.entry.date,
    entryPrice: this.roundTrip.entry.price,
    entryBalance: this.roundTrip.entry.total,

    exitAt: this.roundTrip.exit.date,
    exitPrice: this.roundTrip.exit.price,
    exitBalance: this.roundTrip.exit.total,

    duration: this.roundTrip.exit.date.diff(this.roundTrip.entry.date)
  }

  roundtrip.pnl = roundtrip.exitBalance - roundtrip.entryBalance;
  roundtrip.profit = (100 * roundtrip.exitBalance / roundtrip.entryBalance) - 100;

  this.roundTrips.push(roundtrip);
  //this.handler.handleRoundtrip(roundtrip);

  // we need a cache for sharpe

  // every time we have a new roundtrip
  // update the cached sharpe ratio
  this.sharpe = stats.sharpe(
    this.roundTrips.map(r => r.profit),
    perfConfig.riskFreeReturn
  );
}

Actor.prototype.emitRoundTrips = function() {
  let last5trades = this.roundTrips.slice(-5);
  console.log(last5trades);
  if (last5trades.length === 0) return;
  let profitArray = last5trades.map(r => (r.profit > 0 ? "+" : "")+r.profit.toFixed(2)+"%").join('\n');
  let entryAtArray = last5trades.map(r => moment(r.entryAt).format("L")+" "+moment(r.entryAt).format("LT")).join('\n');
  let durationArray = last5trades.map(r => moment.duration(r.duration).humanize()).join('\n');
  //console.log(profitArray);

  var tradeReport = {
    "embed": {
      "author": {
        "name": "Trades Report",
        "icon_url": "https://twemoji.maxcdn.com/2/72x72/1f4c3.png"
      },

      "color": 2369569,
      "timestamp": moment().format(),
      "footer": {
        "text": "PixelBot © 2018 - Made by @PixelCrunch#5462"
      },
      "fields": [
        {
          "name": "Date",
          "value": "```"+entryAtArray+"```",
          "inline": true
        },{
          "name": "Exposure",
          "value": "```"+durationArray+"```",
          "inline": true
        },
        {
          "name": "Profit/Loss",
          "value": "```"+profitArray+"```",
          "inline": true
        }
      ]

     }
  }

  console.log("Sending Trades Report");
  this.bot.sendMessage({
                    to: discordbot.channel,
                    embed: tradeReport.embed
                });




}

Actor.prototype.calculateReportStatistics = function() {
  // the portfolio's balance is measured in {currency}
  let balance = this.current.currency + this.price * this.current.asset;
  let profit = balance - this.start.balance;

  let timespan = moment.duration(
    this.dates.end.diff(this.dates.start)
  );
  let relativeProfit = balance / this.start.balance * 100 - 100

  let report = {
    currency: this.currency,
    asset: this.asset,

    startTime: this.dates.start.utc().format('YYYY-MM-DD HH:mm:ss'),
    endTime: this.dates.end.utc().format('YYYY-MM-DD HH:mm:ss'),
    timespan: timespan.humanize(),
    market: this.endPrice * 100 / this.startPrice - 100,

    balance: balance,
    profit: profit,
    relativeProfit: relativeProfit,

    yearlyProfit: this.round(profit / timespan.asYears()),
    relativeYearlyProfit: this.round(relativeProfit / timespan.asYears()),

    startPrice: this.startPrice,
    endPrice: this.endPrice,
    trades: this.trades,
    startBalance: this.start.balance,
    sharpe: this.sharpe
  }

  report.alpha = report.profit - report.market;




  return report;
}

Actor.prototype.processAdvice = function(advice) {
  if (advice.recommendation == "soft" && discordbot.muteSoft) {
    console.log(advice.recommendation,discordbot.muteSoft,advice.recommendation == "soft" && discordbot.muteSoft);
    return;}
  this.advice = advice.recommendation;
  this.adviceTime = utc();

  if(discordbot.emitUpdates)
    {//console.log("process");
    this.emitAdvice();}
};

Actor.prototype.verifyQuestion = function(user, userID, channelID, message) {
  console.log(user, userID, channelID, message);
  if(message in this.commands)
    this[this.commands[message]]();
}

Actor.prototype.autoReconnect = function()
 {
   this.bot.sendMessage({ to: discordbot.channel, message: "DEBUG: autoReconnect" });
  this.bot.connect() //Auto reconnect
}

Actor.prototype.newAdvice = function() {
  //this.bot.say(ircbot.channel, 'Guys! Important news!');
  this.bot.sendMessage({
                    to: discordbot.channel,
                    message: 'Guys! Important news!'
                });
  this.emitAdvice();
}

// sent advice over to the IRC channel
Actor.prototype.emitAdvice = function() {
  var price = [
  'Current price is ',
  this.price,
  ' ',
  config.watch.currency
].join('');

var signal = {
    "embed": {
      "title": this.advice.toUpperCase()+" on "+config.watch.asset+"/"+config.watch.currency+ " @ " + config.watch.exchange,
      "description": price,
      "color": 296897,
      "timestamp": moment().format(),
      "footer": {
        "text": "PixelBot © 2018 - Made by @PixelCrunch#5462"
      },
      "author": {
        "name": "Market Adviser - using "+config.tradingAdvisor.method+" strategy",
        "icon_url": "https://twemoji.maxcdn.com/2/72x72/1f468-1f3fb-200d-1f4bc.png"
      }
    }
  }

//this.bot.say(ircbot.channel, message);
//console.log("here");
this.bot.sendMessage({
                  to: discordbot.channel,
                  embed: signal.embed
              });
console.log(discordbot.channel);

};

// sent price over to the IRC channel
Actor.prototype.emitPrice = function() {

  var message = [
    'Current price at ',
    config.watch.exchange,
    ' ',
    config.watch.currency,
    '/',
    config.watch.asset,
    ' is ',
    this.price,
    ' ',
    config.watch.currency
  ].join('');

  var priceReport = {
      "embed": {
        "title": message,
        "color": 296897,
        "timestamp": moment().format(),
        "footer": {
          "text": "PixelBot © 2018 - Made by @PixelCrunch#5462"
        },
        "author": {
          "name": "Price Watcher",
          "icon_url": "https://twemoji.maxcdn.com/2/72x72/1f52d.png"
        }
      }
    }

  this.bot.sendMessage({ to: discordbot.channel, embed: priceReport.embed });
};

// sent donation info over to the IRC channel
Actor.prototype.emitDonation = function() {
  var message = 'You want to donate? How nice of you! You can send your coins here:';
  message += '\nETH:\t0x387cdc472133A764545EBB96eeE086fa2e26dF5F';

  this.bot.sendMessage({
                    to: discordbot.channel,
                    message: message
                });
};

Actor.prototype.emitHelp = function() {
  var message = _.reduce(
    this.rawCommands,
    function(message, command) {
      return message + ' ' + command + ',';
    },
    'possible commands are:'
  );

  message = message.substr(0, _.size(message) - 1) + '.';
  console.log("help given",discordbot.channel,message,this.bot.channels[0]);
  this.bot.sendMessage({
                    to: discordbot.channel,
                    message: message
                });
}

Actor.prototype.emitRealAdvice = function() {
  // http://www.examiner.com/article/uncaged-a-look-at-the-top-10-quotes-of-gordon-gekko
  // http://elitedaily.com/money/memorable-gordon-gekko-quotes/
  var realAdvice = [
    'I don\'t throw darts at a board. I bet on sure things. Read Sun-tzu, The Art of War. Every battle is won before it is ever fought.',
    'Ever wonder why fund managers can\'t beat the S&P 500? \'Cause they\'re sheep, and sheep get slaughtered.',
    'If you\'re not inside, you\'re outside!',
    'The most valuable commodity I know of is information.',
    'It\'s not a question of enough, pal. It\'s a zero sum game, somebody wins, somebody loses. Money itself isn\'t lost or made, it\'s simply transferred from one perception to another.',
    'What\'s worth doing is worth doing for money. (Wait, wasn\'t I a free and open source bot?)',
    'When I get a hold of the son of a bitch who leaked this, I\'m gonna tear his eyeballs out and I\'m gonna suck his fucking skull.'
  ];

  //this.bot.say(ircbot.channel, _.first(_.shuffle(realAdvice)));
  this.bot.sendMessage({
                    to: discordbot.channel,
                    message: _.first(_.shuffle(realAdvice))
                });
}

Actor.prototype.logError = function(message) {
  log.error('DISCORD ERROR:', message);
};


module.exports = Actor;
