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

  // 测试 30 个投标人
  it("should test with 30 bidders", async () => {
    await runAuctionTest(30);
  });

  // 测试 35 个投标人
  it("should test with 35 bidders", async () => {
    await runAuctionTest(35);
  });

  // 通用的拍卖测试函数
  async function runAuctionTest(numBidders) {
    const gasCosts = {};
    const testBidders = bidders.slice(0, numBidders); // 取前 N 个投标人
    
    console.log(`\n=== Testing with ${numBidders} bidders ===`);

    // 1. 创建拍卖
    console.log("1. Creating auction...");
    const createTx = await auctionInstance.createAuction(
      "QmXYZ...ModelRequirements",
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0.1", "ether"),
      300
    );
    gasCosts.createAuction = createTx.receipt.gasUsed;
    const auctionId = createTx.logs[0].args.auctionId.toNumber();

    // 2. 模拟多个投标人投标
    console.log(`2. Submitting ${numBidders} bids...`);
    const bidAmount = web3.utils.toWei("1", "ether");
    const totalBidValue = web3.utils.toWei("1.1", "ether");
    
    const bidGasCosts = [];
    for (let i = 0; i < numBidders; i++) {
      const bidTx = await auctionInstance.submitBid(auctionId, `QmModel${i}CID`, { 
        from: testBidders[i], 
        value: totalBidValue 
      });
      bidGasCosts.push(bidTx.receipt.gasUsed);
      console.log(`   Bidder ${i+1} submitted bid`);
    }
    gasCosts.submitBid_avg = bidGasCosts.reduce((a, b) => a + b, 0) / bidGasCosts.length;
    gasCosts.submitBid_total = bidGasCosts.reduce((a, b) => a + b, 0);

    // 3. 推进时间到投标结束后
    console.log("3. Advancing time...");
    await increaseTime(301);

    // 4. 最终确定拍卖（随机选择一个获胜者）
    console.log("4. Finalizing auction...");
    const winningBidIndex = Math.floor(Math.random() * numBidders); // 随机选择获胜者
    const finalizeTx = await auctionInstance.finalizeAuction(auctionId, winningBidIndex, { from: buyer });
    gasCosts.finalizeAuction = finalizeTx.receipt.gasUsed;

    // 5. 买家支付
    console.log("5. Making payment...");
    const paymentTx = await auctionInstance.makePayment(auctionId, { 
      from: buyer, 
      value: bidAmount 
    });
    gasCosts.makePayment = paymentTx.receipt.gasUsed;

    // 6. 退还押金（所有未中标者）
    console.log("6. Refunding deposits...");
    const losers = testBidders.filter((_, index) => index !== winningBidIndex);
    const refundTx = await auctionInstance.refundDeposits(auctionId, losers, { from: buyer });
    gasCosts.refundDeposits = refundTx.receipt.gasUsed;

    // 计算总成本
    const totalGas = Object.values(gasCosts).reduce((a, b) => a + b, 0);
    
    // 打印这个测试场景的结果
    printScalabilityResults(numBidders, gasCosts, totalGas);
  }

  // 专门用于可扩展性分析的打印函数
  function printScalabilityResults(numBidders, gasCosts, totalGas) {
    const gasPriceInGwei = 20;
    const ethPriceInUSD = 2000;
    const totalCostInUSD = (totalGas * gasPriceInGwei * 1e9) / 1e18 * ethPriceInUSD;

    console.log("\n" + "=".repeat(60));
    console.log(`SCALABILITY RESULTS: ${numBidders} BIDDERS`);
    console.log("=".repeat(60));
    
    console.log("Gas Costs:".padEnd(25), "Total".padEnd(10), "Avg per Bidder");
    console.log("-".repeat(60));
    console.log("createAuction:".padEnd(25), gasCosts.createAuction.toString().padEnd(10), "-");
    console.log("submitBid:".padEnd(25), gasCosts.submitBid_total.toString().padEnd(10), gasCosts.submitBid_avg.toFixed(0));
    console.log("finalizeAuction:".padEnd(25), gasCosts.finalizeAuction.toString().padEnd(10), "-");
    console.log("makePayment:".padEnd(25), gasCosts.makePayment.toString().padEnd(10), "-");
    console.log("refundDeposits:".padEnd(25), gasCosts.refundDeposits.toString().padEnd(10), "-");
    console.log("-".repeat(60));
    console.log("TOTAL GAS:".padEnd(25), totalGas.toString().padEnd(10), "-");
    console.log("TOTAL COST (USD):".padEnd(25), `$${totalCostInUSD.toFixed(2)}`.padEnd(10), "-");
    
    // 特别输出每个投标人的边际成本
    const marginalCostPerBidder = (gasCosts.submitBid_avg * gasPriceInGwei * 1e9) / 1e18 * ethPriceInUSD;
    console.log("MARGINAL COST per Bidder:".padEnd(25), `$${marginalCostPerBidder.toFixed(2)}`.padEnd(10), "-");
    console.log("=".repeat(60));
  }
});