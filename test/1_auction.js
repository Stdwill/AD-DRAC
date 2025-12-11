// 用来测试同时进行多笔拍卖的测试文件
console.log(`Mutiple auction`);

const ModelReverseAuction = artifacts.require("ModelReverseAuction");

contract("ModelReverseAuction: Concurrent Auctions Performance", (accounts) => {
  const [mainBuyer, ...allBidders] = accounts;
  let auctionInstance;

  beforeEach(async () => {
    auctionInstance = await ModelReverseAuction.new();
  });

  // 时间推进辅助函数
  const increaseTime = function(duration) {
    return new Promise((resolve, reject) => {
      web3.currentProvider.send({
        jsonrpc: "2.0",
        method: "evm_increaseTime",
        params: [duration],
        id: new Date().getTime()
      }, (err1) => {
        if (err1) return reject(err1);
        web3.currentProvider.send({
          jsonrpc: "2.0", 
          method: "evm_mine",
          params: [],
          id: new Date().getTime()
        }, (err2, res) => {
          return err2 ? reject(err2) : resolve(res);
        });
      });
    });
  };

  // 测试不同数量的并发拍卖
  it("should test with 20 concurrent auctions", async () => {
    await runConcurrentAuctionsTest(10, 2);
  });

//   it("should test with 20 concurrent auctions", async () => {
//     await runConcurrentAuctionsTest(20, 20);
//   });

//   it("should test with 30 concurrent auctions", async () => {
//     await runConcurrentAuctionsTest(30, 20);
//   });

//   it("should test with 40 concurrent auctions", async () => {
//     await runConcurrentAuctionsTest(40, 20);
//   });

//   it("should test with 50 concurrent auctions", async () => {
//     await runConcurrentAuctionsTest(50, 20);
//   });

  // 并发拍卖测试函数
  async function runConcurrentAuctionsTest(numAuctions, biddersPerAuction) {
    // 添加：记录测试开始时间
    const testStartTime = Date.now();

    console.log(`\n=== Testing ${numAuctions} Concurrent Auctions (${biddersPerAuction} bidders each) ===`);
    
    const results = {
      auctionCreation: { delays: [], gasCosts: [] },
      bidSubmissions: { delays: [], gasCosts: [] },
      auctionFinalization: { delays: [], gasCosts: [] },
      payments: { delays: [], gasCosts: [] },
      refunds: { delays: [], gasCosts: [] }
    };

    const auctionIds = [];
    const auctionData = [];

    // 阶段1: 并发创建多个拍卖
    console.log(`1. Creating ${numAuctions} auctions concurrently...`);
    const creationPromises = [];
    
    for (let i = 0; i < numAuctions; i++) {
      const creationPromise = (async () => {
        const startTime = Date.now();
        const tx = await auctionInstance.createAuction(
          `QmAuction${i}Requirements`,
          web3.utils.toWei("1", "ether"),
          web3.utils.toWei("0.1", "ether"),
          300,
          { from: mainBuyer }
        );
        const endTime = Date.now();
        
        const auctionId = tx.logs[0].args.auctionId.toNumber();
        results.auctionCreation.delays.push(endTime - startTime);
        results.auctionCreation.gasCosts.push(tx.receipt.gasUsed);
        auctionIds.push(auctionId);
        
        return { auctionId, index: i };
      })();
      creationPromises.push(creationPromise);
    }

    // 等待所有拍卖创建完成
    const createdAuctions = await Promise.all(creationPromises);
    console.log(`   Created ${createdAuctions.length} auctions`);

    // 阶段2: 为每个拍卖并发提交投标
    console.log(`2. Submitting bids for all auctions (total: ${numAuctions * biddersPerAuction} bids)...`);
    const bidPromises = [];
    
    for (const auction of createdAuctions) {
      for (let bidderIndex = 0; bidderIndex < biddersPerAuction; bidderIndex++) {
        // 计算投标人账户索引，确保不重复使用同一账户在同一拍卖中
        const bidderAccountIndex = (auction.index * biddersPerAuction + bidderIndex) % allBidders.length;
        const bidder = allBidders[bidderAccountIndex];
        
        const bidPromise = (async () => {
          const startTime = Date.now();
          const tx = await auctionInstance.submitBid(
            auction.auctionId,
            `QmModel_${auction.index}_${bidderIndex}`,
            { 
              from: bidder, 
              value: web3.utils.toWei("1.1", "ether")
            }
          );
          const endTime = Date.now();
          
          results.bidSubmissions.delays.push(endTime - startTime);
          results.bidSubmissions.gasCosts.push(tx.receipt.gasUsed);
          
          return { auctionId: auction.auctionId, bidderIndex };
        })();
        bidPromises.push(bidPromise);
      }
    }

    // 等待所有投标完成
    await Promise.all(bidPromises);
    console.log(`   All ${bidPromises.length} bids submitted`);

    // 阶段3: 推进时间到所有拍卖结束后
    console.log("3. Advancing time for all auctions to end...");
    await increaseTime(301);

    // 阶段4: 并发最终确定所有拍卖
    console.log(`4. Finalizing ${numAuctions} auctions concurrently...`);
    const finalizationPromises = [];
    
    for (const auction of createdAuctions) {
      const finalizationPromise = (async () => {
        const startTime = Date.now();
        // 随机选择每个拍卖的获胜者
        const winningBidIndex = Math.floor(Math.random() * biddersPerAuction);
        const tx = await auctionInstance.finalizeAuction(
          auction.auctionId, 
          winningBidIndex, 
          { from: mainBuyer }
        );
        const endTime = Date.now();
        
        results.auctionFinalization.delays.push(endTime - startTime);
        results.auctionFinalization.gasCosts.push(tx.receipt.gasUsed);
        
        // 存储拍卖数据用于后续支付和退款
        auctionData.push({
          auctionId: auction.auctionId,
          winningBidIndex,
          biddersPerAuction
        });
        
        return auction.auctionId;
      })();
      finalizationPromises.push(finalizationPromise);
    }

    await Promise.all(finalizationPromises);
    console.log(`   Finalized ${finalizationPromises.length} auctions`);

    // 阶段5: 并发支付所有拍卖
    console.log(`5. Making payments for ${numAuctions} auctions concurrently...`);
    const paymentPromises = [];
    
    for (const auction of auctionData) {
      const paymentPromise = (async () => {
        const startTime = Date.now();
        const tx = await auctionInstance.makePayment(
          auction.auctionId,
          { 
            from: mainBuyer, 
            value: web3.utils.toWei("1", "ether")
          }
        );
        const endTime = Date.now();
        
        results.payments.delays.push(endTime - startTime);
        results.payments.gasCosts.push(tx.receipt.gasUsed);
        
        return auction.auctionId;
      })();
      paymentPromises.push(paymentPromise);
    }

    await Promise.all(paymentPromises);
    console.log(`   Made ${paymentPromises.length} payments`);

    // 阶段6: 并发处理所有拍卖的退款
    console.log(`6. Processing refunds for ${numAuctions} auctions concurrently...`);
    const refundPromises = [];
    
    for (const auction of auctionData) {
      const refundPromise = (async () => {
        // 为每个拍卖找出未中标者
        const losers = [];
        for (let i = 0; i < auction.biddersPerAuction; i++) {
          if (i !== auction.winningBidIndex) {
            const bidderAccountIndex = (auction.auctionId * auction.biddersPerAuction + i) % allBidders.length;
            losers.push(allBidders[bidderAccountIndex]);
          }
        }
        
        const startTime = Date.now();
        const tx = await auctionInstance.refundDeposits(
          auction.auctionId,
          losers,
          { from: mainBuyer }
        );
        const endTime = Date.now();
        
        results.refunds.delays.push(endTime - startTime);
        results.refunds.gasCosts.push(tx.receipt.gasUsed);
        
        return auction.auctionId;
      })();
      refundPromises.push(refundPromise);
    }

    await Promise.all(refundPromises);
    console.log(`   Processed ${refundPromises.length} refund batches`);

    // 添加：记录测试结束时间
    const testEndTime = Date.now();
    const totalTestTime = testEndTime - testStartTime;

    // 打印并发性能结果 - 传入总时间参数
    printConcurrentResults(numAuctions, biddersPerAuction, results, totalTestTime);
  }

  // 并发测试结果打印函数
  function printConcurrentResults(numAuctions, biddersPerAuction, results, totalTestTime) {
    console.log("\n" + "=".repeat(80));
    console.log(`CONCURRENT AUCTIONS PERFORMANCE: ${numAuctions} Auctions × ${biddersPerAuction} Bidders`);
    console.log("=".repeat(80));
    
    // 计算统计信息
    const calculateStats = (delays, gasCosts) => ({
      count: delays.length,
      avgDelay: delays.reduce((a, b) => a + b, 0) / delays.length,
      minDelay: Math.min(...delays),
      maxDelay: Math.max(...delays),
      avgGas: gasCosts.reduce((a, b) => a + b, 0) / gasCosts.length,
      totalGas: gasCosts.reduce((a, b) => a + b, 0)
    });

    const creationStats = calculateStats(results.auctionCreation.delays, results.auctionCreation.gasCosts);
    const bidStats = calculateStats(results.bidSubmissions.delays, results.bidSubmissions.gasCosts);
    const finalizationStats = calculateStats(results.auctionFinalization.delays, results.auctionFinalization.gasCosts);
    const paymentStats = calculateStats(results.payments.delays, results.payments.gasCosts);
    const refundStats = calculateStats(results.refunds.delays, results.refunds.gasCosts);

    console.log("\n--- PERFORMANCE SUMMARY ---");
    console.log("Operation".padEnd(25), "Count".padEnd(8), "Avg Delay".padEnd(12), "Min-Max Delay".padEnd(16), "Avg Gas".padEnd(10), "Total Gas");
    console.log("-".repeat(80));
    console.log(
      "Auction Creation:".padEnd(25),
      creationStats.count.toString().padEnd(8),
      `${creationStats.avgDelay.toFixed(1)}ms`.padEnd(12),
      `${creationStats.minDelay}-${creationStats.maxDelay}ms`.padEnd(16),
      creationStats.avgGas.toFixed(0).padEnd(10),
      creationStats.totalGas
    );
    console.log(
      "Bid Submission:".padEnd(25),
      bidStats.count.toString().padEnd(8),
      `${bidStats.avgDelay.toFixed(1)}ms`.padEnd(12),
      `${bidStats.minDelay}-${bidStats.maxDelay}ms`.padEnd(16),
      bidStats.avgGas.toFixed(0).padEnd(10),
      bidStats.totalGas
    );
    console.log(
      "Auction Finalize:".padEnd(25),
      finalizationStats.count.toString().padEnd(8),
      `${finalizationStats.avgDelay.toFixed(1)}ms`.padEnd(12),
      `${finalizationStats.minDelay}-${finalizationStats.maxDelay}ms`.padEnd(16),
      finalizationStats.avgGas.toFixed(0).padEnd(10),
      finalizationStats.totalGas
    );
    console.log(
      "Payment:".padEnd(25),
      paymentStats.count.toString().padEnd(8),
      `${paymentStats.avgDelay.toFixed(1)}ms`.padEnd(12),
      `${paymentStats.minDelay}-${paymentStats.maxDelay}ms`.padEnd(16),
      paymentStats.avgGas.toFixed(0).padEnd(10),
      paymentStats.totalGas
    );
    console.log(
      "Refund:".padEnd(25),
      refundStats.count.toString().padEnd(8),
      `${refundStats.avgDelay.toFixed(1)}ms`.padEnd(12),
      `${refundStats.minDelay}-${refundStats.maxDelay}ms`.padEnd(16),
      refundStats.avgGas.toFixed(0).padEnd(10),
      refundStats.totalGas
    );

    // 总体统计
    const totalTransactions = creationStats.count + bidStats.count + finalizationStats.count + paymentStats.count + refundStats.count;
    const totalGas = creationStats.totalGas + bidStats.totalGas + finalizationStats.totalGas + paymentStats.totalGas + refundStats.totalGas;
    
    console.log("-".repeat(80));
    console.log(
      "TOTAL:".padEnd(25),
      totalTransactions.toString().padEnd(8),
      "-".padEnd(12),
      "-".padEnd(16),
      "-".padEnd(10),
      totalGas
    );

    // ========== 新增：交易确认延迟分析 ==========
    console.log("\n--- TRANSACTION CONFIRMATION DELAY ANALYSIS ---");
  
    // 计算整体平均延迟（所有交易的平均值）
    const allDelays = [
        ...results.auctionCreation.delays,
        ...results.bidSubmissions.delays,
        ...results.auctionFinalization.delays,
        ...results.payments.delays,
        ...results.refunds.delays
    ];
  
    const overallAvgDelay = allDelays.reduce((a, b) => a + b, 0) / allDelays.length;
    const minOverallDelay = Math.min(...allDelays);
    const maxOverallDelay = Math.max(...allDelays);
    
    console.log(`Overall Average Delay: ${overallAvgDelay.toFixed(2)}ms`);
    console.log(`Overall Min-Max Delay: ${minOverallDelay}ms - ${maxOverallDelay}ms`);
    console.log(`Total Test Duration: ${totalTestTime}ms`);
    
    // 计算TPS（每秒处理交易数）
    const transactionsPerSecond = (totalTransactions / (totalTestTime / 1000)).toFixed(2);
    console.log(`Throughput: ${transactionsPerSecond} TPS (transactions per second)`);

    // 成本估算
    const gasPriceInGwei = 20;
    const ethPriceInUSD = 2000;
    const totalCostInUSD = (totalGas * gasPriceInGwei * 1e9) / 1e18 * ethPriceInUSD;
    const costPerAuction = totalCostInUSD / numAuctions;
    
    console.log("\n--- COST ANALYSIS ---");
    console.log(`Total Cost for ${numAuctions} auctions: $${totalCostInUSD.toFixed(2)}`);
    console.log(`Cost per auction: $${costPerAuction.toFixed(2)}`);
    console.log(`Total transactions processed: ${totalTransactions}`);
    
    console.log("=".repeat(80));
  }
});