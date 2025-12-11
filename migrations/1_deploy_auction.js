const ModelReverseAuction = artifacts.require("ModelReverseAuction");

module.exports = function (deployer) {
  // 直接部署合约，不需要构造函数参数
  deployer.deploy(ModelReverseAuction);
  
  // 如果需要构造函数参数，可以这样写：
  // deployer.deploy(ModelReverseAuction, arg1, arg2, ...);
};