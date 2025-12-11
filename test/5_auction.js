const ModelReverseAuction = artifacts.require("ModelReverseAuction");

contract("ModelReverseAuction: Gas Cost Analysis", (accounts) => {
  const [buyer, bidder1, bidder2, bidder3] = accounts;
  let auctionInstance;
  let auctionId;

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

  it("should complete a full auction cycle and record gas costs", async () => {
    const gasCosts = {};

    // 1. 创建拍卖
    console.log("1. Creating auction...");
    const createTx = await auctionInstance.createAuction(
      "QmXYZ...ModelRequirements",
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0.1", "ether"),
      300  // 投标持续300秒
    );
    gasCosts.createAuction = createTx.receipt.gasUsed;
    auctionId = createTx.logs[0].args.auctionId.toNumber();
    console.log("   Auction created with ID:", auctionId);

    // 2. 模拟投标
    console.log("2. Submitting bids...");
    const bidAmount = web3.utils.toWei("1", "ether");
    const totalBidValue = web3.utils.toWei("1.1", "ether"); // 出价 + 押金

    const bid1Tx = await auctionInstance.submitBid(auctionId, "QmModel1CID", { 
      from: bidder1, 
      value: totalBidValue 
    });
    gasCosts.bid1 = bid1Tx.receipt.gasUsed;
    console.log("   Bidder 1 submitted bid");

    const bid2Tx = await auctionInstance.submitBid(auctionId, "QmModel2CID", { 
      from: bidder2, 
      value: totalBidValue 
    });
    gasCosts.bid2 = bid2Tx.receipt.gasUsed;
    console.log("   Bidder 2 submitted bid");

    const bid3Tx = await auctionInstance.submitBid(auctionId, "QmModel3CID", { 
      from: bidder3, 
      value: totalBidValue 
    });
    gasCosts.bid3 = bid3Tx.receipt.gasUsed;
    console.log("   Bidder 3 submitted bid");

    // 3. 推进时间到投标结束后 - 使用正确定义的 increaseTime 函数
    console.log("3. Advancing time...");
    await increaseTime(301);  // 等待301秒，超过投标期

    // 4. 最终确定拍卖（选择第二个投标人作为获胜者）
    console.log("4. Finalizing auction...");
    const finalizeTx = await auctionInstance.finalizeAuction(auctionId, 1, { from: buyer });
    gasCosts.finalizeAuction = finalizeTx.receipt.gasUsed;
    console.log("   Auction finalized");

    // 5. 买家支付
    console.log("5. Making payment...");
    const paymentTx = await auctionInstance.makePayment(auctionId, { 
      from: buyer, 
      value: bidAmount 
    });
    gasCosts.makePayment = paymentTx.receipt.gasUsed;
    console.log("   Payment made");

    // 6. 退还押金
    console.log("6. Refunding deposits...");
    const refundTx = await auctionInstance.refundDeposits(auctionId, [bidder1, bidder3], { from: buyer });
    gasCosts.refundDeposits = refundTx.receipt.gasUsed;
    console.log("   Deposits refunded");

    // 打印结果
    printGasAnalysis(gasCosts);

    // 验证最终状态
    const auction = await auctionInstance.getAuction(auctionId);
    assert.equal(auction.isPaid, true, "Auction should be marked as paid");
    assert.equal(auction.winningBidder, bidder2, "Bidder 2 should be the winner");
  });

  // 辅助函数：打印Gas分析
  function printGasAnalysis(gasCosts) {
    console.log("\n" + "=".repeat(50));
    console.log("GAS COST ANALYSIS");
    console.log("=".repeat(50));
    
    console.log("\n--- Raw Gas Costs ---");
    console.log("createAuction:".padEnd(20), gasCosts.createAuction);
    console.log("submitBid (avg):".padEnd(20), Math.round((gasCosts.bid1 + gasCosts.bid2 + gasCosts.bid3) / 3));
    console.log("finalizeAuction:".padEnd(20), gasCosts.finalizeAuction);
    console.log("makePayment:".padEnd(20), gasCosts.makePayment);
    console.log("refundDeposits:".padEnd(20), gasCosts.refundDeposits);

    const totalGas = Object.values(gasCosts).reduce((a, b) => a + b, 0);
    console.log("TOTAL GAS:".padEnd(20), totalGas);

    // 转换为法币成本
    console.log("\n--- Monetary Cost Estimation ---");
    const gasPriceInGwei = 20; // 假设 Gas 价格为 20 Gwei
    const ethPriceInUSD = 2000; // 假设 1 ETH = $2000
    
    console.log("Assumptions:");
    console.log("Gas Price:".padEnd(20), gasPriceInGwei + " Gwei");
    console.log("ETH Price:".padEnd(20), "$" + ethPriceInUSD);

    const totalGasCostInETH = (totalGas * gasPriceInGwei * 1e9) / 1e18;
    const totalGasCostInUSD = totalGasCostInETH * ethPriceInUSD;

    console.log("\nTotal Cost (ETH):".padEnd(20), totalGasCostInETH.toFixed(6));
    console.log("Total Cost (USD):".padEnd(20), "$" + totalGasCostInUSD.toFixed(2));

    console.log("\n--- Cost Breakdown ---");
    for (const [operation, gas] of Object.entries(gasCosts)) {
      const costInETH = (gas * gasPriceInGwei * 1e9) / 1e18;
      const costInUSD = costInETH * ethPriceInUSD;
      console.log(`${operation.padEnd(20)} $${costInUSD.toFixed(2)}`);
    }
    
    console.log("=".repeat(50));
  }
});