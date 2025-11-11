require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-network-helpers");
require("@nomicfoundation/hardhat-ignition-ethers");
require("dotenv").config();
const fs = require("fs");

// Custom task to deploy to Status Network
task("deploy-status", "Deploy DossierV3 to Status Network Sepolia")
  .setAction(async (taskArgs, hre) => {
    console.log("\n🚀 Deploying CanaryDossierV3 to Status Network Sepolia...\n");

    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying with account:", deployer.address);

    const balance = await deployer.provider.getBalance(deployer.address);
    console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");
    console.log("Note: Status Network uses gasless transactions via RLN rate-limiting.\n");

    console.log("\n📦 Compiling contract...");
    const DossierV3 = await hre.ethers.getContractFactory("CanaryDossierV3");

    console.log("\n📝 Deploying contract...");
    const contract = await DossierV3.deploy({
      gasPrice: 0,
      gasLimit: 10000000
    });
    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();

    console.log("\n✅ Contract deployed successfully!");
    console.log("📍 Contract address:", contractAddress);
    console.log("📊 Transaction hash:", contract.deploymentTransaction().hash);
    console.log("🔗 View on explorer: https://sepoliascan.status.network/address/" + contractAddress);

    console.log("\n⏳ Waiting for confirmations...");
    await contract.deploymentTransaction().wait(3);

    const deploymentInfo = {
      network: "status-sepolia",
      chainId: 1660990954,
      address: contractAddress,
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
      txHash: contract.deploymentTransaction().hash,
      blockNumber: contract.deploymentTransaction().blockNumber,
      explorerUrl: `https://sepoliascan.status.network/address/${contractAddress}`
    };

    if (!fs.existsSync("./deployments")) {
      fs.mkdirSync("./deployments");
    }

    const filename = `./deployments/DossierV3_statusSepolia_${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
    console.log("\n💾 Deployment info saved to:", filename);

    console.log("\n📝 Updating .env.local with new contract address...");
    const envFile = ".env.local";
    let envContent = "";

    if (fs.existsSync(envFile)) {
      envContent = fs.readFileSync(envFile, "utf8");
    }

    const envKey = "NEXT_PUBLIC_CANARY_DOSSIER_STATUS_ADDRESS";
    const envLine = `${envKey}=${contractAddress}`;

    if (envContent.includes(envKey)) {
      envContent = envContent.replace(
        new RegExp(`${envKey}=.*`, "g"),
        envLine
      );
    } else {
      envContent += `\n# DossierV3 Contract on Status Network (Deployed ${new Date().toISOString()})\n${envLine}\n`;
    }

    fs.writeFileSync(envFile, envContent);
    console.log("✅ Updated .env.local");

    console.log("\n🎉 Deployment complete!");
    console.log("\n💡 Status Network Features:");
    console.log("   • Gasless transactions via RLN rate-limiting");
    console.log("   • Built on Linea zkEVM");
    console.log("   • Rate limit: 10 requests/second, 100k requests/day");
    console.log("\n🔗 Explorer:", deploymentInfo.explorerUrl);
  });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337,
      gas: "auto",
      gasPrice: "auto",
      gasMultiplier: 1,
      blockGasLimit: 30000000,
      allowUnlimitedContractSize: true
    },
    statusSepolia: {
      url: 'https://public.sepolia.rpc.status.network',
      chainId: 1660990954,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gas: "auto",
      gasPrice: "auto"
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  mocha: {
    timeout: 40000
  }
};
