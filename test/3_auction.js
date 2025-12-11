// 用来测试交易延迟的测试文件
const ModelReverseAuction = artifacts.require("ModelReverseAuction");

contract("ModelReverseAuction: Scalability Analysis", (accounts) => {
  const [buyer, ...bidders] = accounts; // 使用剩余参数获取所有投标人账户
  let auctionInstance;

  beforeEach(async () => {
    auctionInstance = await ModelReverseAuction.new();
  });

  // 时间推进辅助函数（保持不变）
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

  // 测试 15 个投标人
  it("should test with 15 bidders", async () => {
    await runAuctionTest(15);
  });

  // 测试 25 个投标人
  it("should test with 25 bidders", async () => {
    await runAuctionTest(25);
  });

  // 测试 35 个投标人
  it("should test with 35 bidders", async () => {
    await runAuctionTest(35);
  });

  // 测试 45 个投标人
  it("should test with 45 bidders", async () => {
    await runAuctionTest(45);
  });

  // 通用的拍卖测试函数 - 添加延迟测量
  async function runAuctionTest(numBidders) {
    const gasCosts = {};
    const testBidders = bidders.slice(0, numBidders); // 取前 N 个投标人
    
    console.log(`\n=== Testing with ${numBidders} bidders ===`);

    // 1. 创建拍卖 - 添加延迟测量
    console.log("1. Creating auction...");
    const createStartTime = Date.now();
    const createTx = await auctionInstance.createAuction(
      "QmXYZ...ModelRequirements",
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0.1", "ether"),
      300
    );
    const createEndTime = Date.now();
    const createDelay = createEndTime - createStartTime;
    gasCosts.createAuction = createTx.receipt.gasUsed;
    const auctionId = createTx.logs[0].args.auctionId.toNumber();

    // 2. 模拟多个投标人投标 - 添加延迟测量
    console.log(`2. Submitting ${numBidders} bids...`);
    const bidAmount = web3.utils.toWei("1", "ether");
    const totalBidValue = web3.utils.toWei("1.1", "ether");
    
    const bidGasCosts = [];
    const bidDelays = []; // 存储每个投标的延迟
    
    for (let i = 0; i < numBidders; i++) {
      const bidStartTime = Date.now();
      const bidTx = await auctionInstance.submitBid(auctionId, `QmModel${i}CID`, { 
        from: testBidders[i], 
        value: totalBidValue 
      });
      const bidEndTime = Date.now();
      const bidDelay = bidEndTime - bidStartTime;
      
      bidGasCosts.push(bidTx.receipt.gasUsed);
      bidDelays.push(bidDelay);
      console.log(`   Bidder ${i+1} submitted bid - Delay: ${bidDelay}ms`);
    }
    gasCosts.submitBid_avg = bidGasCosts.reduce((a, b) => a + b, 0) / bidGasCosts.length;
    gasCosts.submitBid_total = bidGasCosts.reduce((a, b) => a + b, 0);
    
    // 计算投标的平均延迟
    const averageBidDelay = bidDelays.reduce((a, b) => a + b, 0) / bidDelays.length;

    // 3. 推进时间到投标结束后
    console.log("3. Advancing time...");
    await increaseTime(301);

    // 4. 最终确定拍卖（随机选择一个获胜者）- 添加延迟测量
    console.log("4. Finalizing auction...");
    const finalizeStartTime = Date.now();
    const winningBidIndex = Math.floor(Math.random() * numBidders); // 随机选择获胜者
    const finalizeTx = await auctionInstance.finalizeAuction(auctionId, winningBidIndex, { from: buyer });
    const finalizeEndTime = Date.now();
    const finalizeDelay = finalizeEndTime - finalizeStartTime;
    gasCosts.finalizeAuction = finalizeTx.receipt.gasUsed;

    // 5. 买家支付 - 添加延迟测量
    console.log("5. Making payment...");
    const paymentStartTime = Date.now();
    const paymentTx = await auctionInstance.makePayment(auctionId, { 
      from: buyer, 
      value: bidAmount 
    });
    const paymentEndTime = Date.now();
    const paymentDelay = paymentEndTime - paymentStartTime;
    gasCosts.makePayment = paymentTx.receipt.gasUsed;

    // 6. 退还押金（所有未中标者）- 添加延迟测量
    console.log("6. Refunding deposits...");
    const refundStartTime = Date.now();
    const losers = testBidders.filter((_, index) => index !== winningBidIndex);
    const refundTx = await auctionInstance.refundDeposits(auctionId, losers, { from: buyer });
    const refundEndTime = Date.now();
    const refundDelay = refundEndTime - refundStartTime;
    gasCosts.refundDeposits = refundTx.receipt.gasUsed;

    // 计算总成本
    const totalGas = Object.values(gasCosts).reduce((a, b) => a + b, 0);
    
    // 打印这个测试场景的结果 - 包含延迟信息
    printScalabilityResults(numBidders, gasCosts, totalGas, {
      createDelay,
      averageBidDelay,
      finalizeDelay,
      paymentDelay,
      refundDelay,
      bidDelays
    });
  }

  // 专门用于可扩展性分析的打印函数 - 添加延迟信息
  function printScalabilityResults(numBidders, gasCosts, totalGas, delays) {
    const gasPriceInGwei = 20;
    const ethPriceInUSD = 2000;
    const totalCostInUSD = (totalGas * gasPriceInGwei * 1e9) / 1e18 * ethPriceInUSD;

    console.log("\n" + "=".repeat(70));
    console.log(`SCALABILITY RESULTS: ${numBidders} BIDDERS`);
    console.log("=".repeat(70));
    
    console.log("Gas Costs:".padEnd(25), "Total".padEnd(10), "Avg per Bidder");
    console.log("-".repeat(70));
    console.log("createAuction:".padEnd(25), gasCosts.createAuction.toString().padEnd(10), "-");
    console.log("submitBid:".padEnd(25), gasCosts.submitBid_total.toString().padEnd(10), gasCosts.submitBid_avg.toFixed(0));
    console.log("finalizeAuction:".padEnd(25), gasCosts.finalizeAuction.toString().padEnd(10), "-");
    console.log("makePayment:".padEnd(25), gasCosts.makePayment.toString().padEnd(10), "-");
    console.log("refundDeposits:".padEnd(25), gasCosts.refundDeposits.toString().padEnd(10), "-");
    console.log("-".repeat(70));
    console.log("TOTAL GAS:".padEnd(25), totalGas.toString().padEnd(10), "-");
    console.log("TOTAL COST (USD):".padEnd(25), `$${totalCostInUSD.toFixed(2)}`.padEnd(10), "-");
    
    // 特别输出每个投标人的边际成本
    const marginalCostPerBidder = (gasCosts.submitBid_avg * gasPriceInGwei * 1e9) / 1e18 * ethPriceInUSD;
    console.log("MARGINAL COST per Bidder:".padEnd(25), `$${marginalCostPerBidder.toFixed(2)}`.padEnd(10), "-");
    
    // 新增：延迟分析部分
    console.log("\n--- TRANSACTION DELAY ANALYSIS ---");
    console.log("Operation".padEnd(25), "Delay (ms)");
    console.log("-".repeat(40));
    console.log("createAuction:".padEnd(25), `${delays.createDelay}ms`);
    console.log("submitBid (avg):".padEnd(25), `${delays.averageBidDelay.toFixed(2)}ms`);
    console.log("finalizeAuction:".padEnd(25), `${delays.finalizeDelay}ms`);
    console.log("makePayment:".padEnd(25), `${delays.paymentDelay}ms`);
    console.log("refundDeposits:".padEnd(25), `${delays.refundDelay}ms`);
    
    // 投标延迟的统计信息
    if (delays.bidDelays.length > 0) {
      const minBidDelay = Math.min(...delays.bidDelays);
      const maxBidDelay = Math.max(...delays.bidDelays);
      console.log("submitBid (min):".padEnd(25), `${minBidDelay}ms`);
      console.log("submitBid (max):".padEnd(25), `${maxBidDelay}ms`);
    }
    
    // 计算总处理时间（近似值）
    const totalProcessingTime = delays.createDelay + 
                              (delays.averageBidDelay * numBidders) + 
                              delays.finalizeDelay + 
                              delays.paymentDelay + 
                              delays.refundDelay;
    console.log("-".repeat(40));
    console.log("EST. TOTAL PROCESSING TIME:".padEnd(25), `${totalProcessingTime.toFixed(0)}ms`);
    
    console.log("=".repeat(70));
  }
});