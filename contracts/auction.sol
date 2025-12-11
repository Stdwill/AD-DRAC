// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;  // 更新为 0.8.x 版本


/**
 * @title ModelReverseAuction
 * @dev 一个用于模型反向拍卖的智能合约，结合链下计算进行复杂评估。
 */
contract ModelReverseAuction {
    // 拍卖状态枚举
    enum AuctionStatus { Open, Closed, Finalized }

    // 拍卖结构体
    struct Auction {
        address payable buyer;       // 买家地址
        string auctionDetails;       // 拍卖需求描述（例如IPFS哈希）
        uint256 minBid;              // 最低出价（保留价）
        uint256 deposit;             // 投标所需押金
        uint256 bidEndTime;          // 投标截止时间
        AuctionStatus status;        // 当前状态
        address winningBidder;       // 中标者地址
        uint256 winningBidAmount;    // 中标金额
        bool isPaid;                 // 是否已完成支付
    }

    // 投标结构体
    struct Bid {
        address bidder;              // 投标人地址
        uint256 amount;              // 出价金额
        string modelCID;             // 模型内容标识符（例如IPFS哈希）
        bool isWinner;               // 是否中标
        bool depositReturned;        // 押金是否已退还
    }

    // 状态变量
    mapping(uint256 => Auction) public auctions; // 拍卖ID到拍卖的映射
    mapping(uint256 => Bid[]) public bids; // 拍卖ID到投标列表的映射
    uint256 public auctionCounter;   // 拍卖计数器

    // 事件，用于前端监听和日志记录
    event AuctionCreated(uint256 indexed auctionId, address indexed buyer, uint256 minBid, uint256 bidEndTime);
    event BidSubmitted(uint256 indexed auctionId, address indexed bidder, uint256 amount, string modelCID);
    event AuctionFinalized(uint256 indexed auctionId, address indexed winner, uint256 winningBidAmount);
    event PaymentMade(uint256 indexed auctionId, address indexed buyer, address indexed seller, uint256 amount);
    event DepositRefunded(uint256 indexed auctionId, address indexed bidder, uint256 amount);

    // 修饰器：只有拍卖的买家可以操作
    modifier onlyBuyer(uint256 _auctionId) {
        require(auctions[_auctionId].buyer == msg.sender, "Only the auction buyer can call this.");
        _;
    }

    // 修饰器：拍卖必须处于特定状态
    modifier onlyStatus(uint256 _auctionId, AuctionStatus _status) {
        require(auctions[_auctionId].status == _status, "Auction is not in the required status.");
        _;
    }

    /**
     * @dev 买家创建一个新的拍卖
     * @param _auctionDetails 拍卖需求的描述（或IPFS哈希）
     * @param _minBid 最低出价（保留价）
     * @param _deposit 投标人需要缴纳的押金
     * @param _bidDurationInSeconds 投标阶段的持续时间（秒）
     */
    function createAuction(
        string memory _auctionDetails,
        uint256 _minBid,
        uint256 _deposit,
        uint256 _bidDurationInSeconds
    ) public returns (uint256) {
        require(_minBid > 0, "Min bid must be positive.");
        require(_bidDurationInSeconds > 0, "Bid duration must be positive.");

        auctionCounter++;
        uint256 newAuctionId = auctionCounter;

        auctions[newAuctionId] = Auction({
            buyer: payable(msg.sender),
            auctionDetails: _auctionDetails,
            minBid: _minBid,
            deposit: _deposit,
            bidEndTime: block.timestamp + _bidDurationInSeconds,
            status: AuctionStatus.Open,
            winningBidder: address(0),
            winningBidAmount: 0,
            isPaid: false
        });

        emit AuctionCreated(newAuctionId, msg.sender, _minBid, auctions[newAuctionId].bidEndTime);
        return newAuctionId;
    }

    /**
     * @dev 投标人向一个开放的拍卖提交投标
     * @param _auctionId 拍卖ID
     * @param _modelCID 模型内容的IPFS哈希
     */
    function submitBid(uint256 _auctionId, string memory _modelCID) 
        public 
        payable 
        onlyStatus(_auctionId, AuctionStatus.Open) 
    {
        Auction storage auction = auctions[_auctionId];
        require(block.timestamp <= auction.bidEndTime, "Bidding period has ended.");
        require(msg.value == auction.deposit + auction.minBid, "Must send exactly deposit + min bid.");

        // 这里可以添加更多业务逻辑，例如检查_modelCID格式等

        bids[_auctionId].push(Bid({
            bidder: msg.sender,
            amount: msg.value - auction.deposit, // 实际出价是发送的总金额减去押金
            modelCID: _modelCID,
            isWinner: false,
            depositReturned: false
        }));

        emit BidSubmitted(_auctionId, msg.sender, msg.value - auction.deposit, _modelCID);
    }

    /**
     * @dev 买家公布最终结果。这个函数应该在链下计算完成后被调用。
     * @param _auctionId 拍卖ID
     * @param _winningBidIndex 中标投标在bids数组中的索引
     */
    function finalizeAuction(uint256 _auctionId, uint256 _winningBidIndex) 
        public 
        onlyBuyer(_auctionId) 
        onlyStatus(_auctionId, AuctionStatus.Open) 
    {
        Auction storage auction = auctions[_auctionId];
        require(block.timestamp > auction.bidEndTime, "Bidding period is not over yet.");
        require(_winningBidIndex < bids[_auctionId].length, "Invalid winning bid index.");

        // 关闭拍卖
        auction.status = AuctionStatus.Closed;
        
        Bid storage winningBid = bids[_auctionId][_winningBidIndex];
        winningBid.isWinner = true;
        
        auction.winningBidder = winningBid.bidder;
        auction.winningBidAmount = winningBid.amount;

        // 将中标者的押金标记为不需退还（将在支付时一并领取）
        winningBid.depositReturned = true;

        emit AuctionFinalized(_auctionId, winningBid.bidder, winningBid.amount);
    }

    /**
     * @dev 买家向中标者支付款项。
     * 注意：在实际应用中，可能需要更复杂的支付逻辑，如托管服务。
     */
    function makePayment(uint256 _auctionId) 
        public 
        payable 
        onlyBuyer(_auctionId) 
        onlyStatus(_auctionId, AuctionStatus.Closed) 
    {
        Auction storage auction = auctions[_auctionId];
        require(!auction.isPaid, "Payment has already been made.");
        require(msg.value == auction.winningBidAmount, "Must send the exact winning bid amount.");

        auction.isPaid = true;

        // 向中标者支付：中标金额 + 返还的押金
        uint256 totalToPay = auction.winningBidAmount + auction.deposit;
        payable(auction.winningBidder).transfer(totalToPay);

        emit PaymentMade(_auctionId, msg.sender, auction.winningBidder, auction.winningBidAmount);
    }

    /**
     * @dev 为未中标的投标人退还押金。
     * 为了节省Gas，可以采用“提取”模式，让投标人自己来取回押金。
     * 这里提供一个由买家批量触发退款的方式（在投标人不多时可行）。
     */
    function refundDeposits(uint256 _auctionId, address[] memory _losers) 
        public 
        onlyBuyer(_auctionId) 
    {
        Auction storage auction = auctions[_auctionId];
        // 只有在拍卖结束且已付款后，才能退还押金，以确保状态清晰。
        require(auction.status == AuctionStatus.Closed && auction.isPaid, "Auction not finalized and paid.");

        for (uint i = 0; i < _losers.length; i++) {
            _refundSingleBidder(_auctionId, _losers[i]);
        }
    }

    /**
     * @dev 内部函数，处理单个投标人的押金退还。
     */
    function _refundSingleBidder(uint256 _auctionId, address _bidder) internal {
        Bid[] storage bidList = bids[_auctionId];
        for (uint j = 0; j < bidList.length; j++) {
            if (bidList[j].bidder == _bidder && !bidList[j].isWinner && !bidList[j].depositReturned) {
                bidList[j].depositReturned = true;
                uint256 depositAmount = auctions[_auctionId].deposit;
                payable(_bidder).transfer(depositAmount);
                emit DepositRefunded(_auctionId, _bidder, depositAmount);
                break; // 假设一个地址在一个拍卖中只投一次标
            }
        }
    }

    // 辅助视图函数，用于前端获取信息
    function getAuction(uint256 _auctionId) public view returns (Auction memory) {
        return auctions[_auctionId];
    }

    function getBidsCount(uint256 _auctionId) public view returns (uint256) {
        return bids[_auctionId].length;
    }

    function getBid(uint256 _auctionId, uint256 _index) public view returns (Bid memory) {
        return bids[_auctionId][_index];
    }
}