const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CanaryDossierV3 - Guardian Features", function () {
  let contract;
  let owner;
  let addr1, addr2, addr3, addr4;
  let guardian1, guardian2, guardian3;

  const MIN_CHECK_IN_INTERVAL = 3600; // 1 hour
  const GRACE_PERIOD = 3600; // 1 hour

  beforeEach(async function () {
    const DossierV3 = await ethers.getContractFactory("CanaryDossierV3");
    contract = await DossierV3.deploy();
    await contract.waitForDeployment();
    [owner, addr1, addr2, addr3, addr4, guardian1, guardian2, guardian3] = await ethers.getSigners();
  });

  describe("Dossier Creation with Guardians", function () {
    it("Should create a dossier with guardians and threshold", async function () {
      const tx = await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [guardian1.address, guardian2.address],
        2 // threshold
      );

      await expect(tx)
        .to.emit(contract, "DossierCreated")
        .withArgs(owner.address, 0, "Test Dossier");

      const dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.guardians.length).to.equal(2);
      expect(dossier.guardians[0]).to.equal(guardian1.address);
      expect(dossier.guardians[1]).to.equal(guardian2.address);
      expect(dossier.guardianThreshold).to.equal(2);
      expect(dossier.guardianConfirmationCount).to.equal(0);
    });

    it("Should create a dossier without guardians", async function () {
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [], // no guardians
        0   // no threshold
      );

      const dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.guardians.length).to.equal(0);
      expect(dossier.guardianThreshold).to.equal(0);
    });

    it("Should reject creation with threshold > guardian count", async function () {
      await expect(
        contract.createDossier(
          "Test",
          "Description",
          3600,
          [addr1.address],
          ["ipfs://test"],
          [guardian1.address],
          2 // threshold exceeds guardian count
        )
      ).to.be.revertedWith("Invalid guardian threshold");
    });

    it("Should reject creation with zero threshold when guardians exist", async function () {
      await expect(
        contract.createDossier(
          "Test",
          "Description",
          3600,
          [addr1.address],
          ["ipfs://test"],
          [guardian1.address],
          0 // threshold must be > 0
        )
      ).to.be.revertedWith("Invalid guardian threshold");
    });

    it("Should reject creation with non-zero threshold but no guardians", async function () {
      await expect(
        contract.createDossier(
          "Test",
          "Description",
          3600,
          [addr1.address],
          ["ipfs://test"],
          [], // no guardians
          1   // but threshold set
        )
      ).to.be.revertedWith("Threshold must be 0 when no guardians");
    });

    it("Should reject creation with duplicate guardians", async function () {
      await expect(
        contract.createDossier(
          "Test",
          "Description",
          3600,
          [addr1.address],
          ["ipfs://test"],
          [guardian1.address, guardian1.address], // duplicate
          2
        )
      ).to.be.revertedWith("Duplicate guardian");
    });

    it("Should reject creation with too many guardians", async function () {
      const tooManyGuardians = Array(21).fill(guardian1.address);
      await expect(
        contract.createDossier(
          "Test",
          "Description",
          3600,
          [addr1.address],
          ["ipfs://test"],
          tooManyGuardians,
          1
        )
      ).to.be.revertedWith("Too many guardians");
    });

    it("Should reject creation with invalid guardian address", async function () {
      await expect(
        contract.createDossier(
          "Test",
          "Description",
          3600,
          [addr1.address],
          ["ipfs://test"],
          [ethers.ZeroAddress],
          1
        )
      ).to.be.revertedWith("Invalid guardian address");
    });
  });

  describe("Guardian Management", function () {
    beforeEach(async function () {
      // Create a dossier without guardians
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [],
        0
      );
    });

    it("Should add a guardian to a dossier", async function () {
      const tx = await contract.addGuardian(0, guardian1.address);

      await expect(tx)
        .to.emit(contract, "GuardianAdded")
        .withArgs(owner.address, 0, guardian1.address);

      const dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.guardians.length).to.equal(1);
      expect(dossier.guardians[0]).to.equal(guardian1.address);
      expect(dossier.guardianThreshold).to.equal(1); // Auto-set to 1
    });

    it("Should add multiple guardians", async function () {
      await contract.addGuardian(0, guardian1.address);
      await contract.addGuardian(0, guardian2.address);
      await contract.addGuardian(0, guardian3.address);

      const dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.guardians.length).to.equal(3);
    });

    it("Should reject adding duplicate guardian", async function () {
      await contract.addGuardian(0, guardian1.address);

      await expect(
        contract.addGuardian(0, guardian1.address)
      ).to.be.revertedWith("Guardian already exists");
    });

    it("Should reject adding owner as guardian", async function () {
      await expect(
        contract.addGuardian(0, owner.address)
      ).to.be.revertedWith("Owner cannot be guardian");
    });

    it("Should reject adding invalid address as guardian", async function () {
      await expect(
        contract.addGuardian(0, ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid guardian address");
    });

    it("Should reject adding guardian to released dossier", async function () {
      await contract.releaseNow(0);

      await expect(
        contract.addGuardian(0, guardian1.address)
      ).to.be.revertedWith("Dossier already released");
    });

    it("Should reject adding guardian to permanently disabled dossier", async function () {
      await contract.permanentlyDisableDossier(0);

      await expect(
        contract.addGuardian(0, guardian1.address)
      ).to.be.revertedWith("Dossier permanently disabled");
    });

    it("Should remove a guardian", async function () {
      await contract.addGuardian(0, guardian1.address);
      await contract.addGuardian(0, guardian2.address);

      const tx = await contract.removeGuardian(0, guardian1.address);

      await expect(tx)
        .to.emit(contract, "GuardianRemoved")
        .withArgs(owner.address, 0, guardian1.address);

      const dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.guardians.length).to.equal(1);
      expect(dossier.guardians[0]).to.equal(guardian2.address);
    });

    it("Should remove guardian and adjust threshold automatically", async function () {
      await contract.addGuardian(0, guardian1.address);
      await contract.addGuardian(0, guardian2.address);
      await contract.addGuardian(0, guardian3.address);
      await contract.updateGuardianThreshold(0, 3);

      await contract.removeGuardian(0, guardian1.address);

      const dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.guardians.length).to.equal(2);
      expect(dossier.guardianThreshold).to.equal(2); // Auto-adjusted
    });

    it("Should remove last guardian and reset threshold", async function () {
      await contract.addGuardian(0, guardian1.address);

      await contract.removeGuardian(0, guardian1.address);

      const dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.guardians.length).to.equal(0);
      expect(dossier.guardianThreshold).to.equal(0);
    });

    it("Should decrement confirmation count when removing confirmed guardian", async function () {
      await contract.addGuardian(0, guardian1.address);
      await contract.addGuardian(0, guardian2.address);
      await contract.updateGuardianThreshold(0, 2);

      // Guardian confirms
      await contract.connect(guardian1).confirmRelease(owner.address, 0);

      const dossierBefore = await contract.getDossier(owner.address, 0);
      expect(dossierBefore.guardianConfirmationCount).to.equal(1);

      // Remove the confirmed guardian
      await contract.removeGuardian(0, guardian1.address);

      const dossierAfter = await contract.getDossier(owner.address, 0);
      expect(dossierAfter.guardianConfirmationCount).to.equal(0);
    });

    it("Should reject removing non-existent guardian", async function () {
      await expect(
        contract.removeGuardian(0, guardian1.address)
      ).to.be.revertedWith("Guardian not found");
    });
  });

  describe("Guardian Threshold Management", function () {
    beforeEach(async function () {
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [guardian1.address, guardian2.address, guardian3.address],
        2
      );
    });

    it("Should update guardian threshold", async function () {
      const tx = await contract.updateGuardianThreshold(0, 3);

      await expect(tx)
        .to.emit(contract, "GuardianThresholdUpdated")
        .withArgs(owner.address, 0, 3);

      const dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.guardianThreshold).to.equal(3);
    });

    it("Should reject threshold exceeding guardian count", async function () {
      await expect(
        contract.updateGuardianThreshold(0, 4)
      ).to.be.revertedWith("Invalid guardian threshold");
    });

    it("Should reject zero threshold when guardians exist", async function () {
      await expect(
        contract.updateGuardianThreshold(0, 0)
      ).to.be.revertedWith("Invalid guardian threshold");
    });
  });

  describe("Guardian Confirmations", function () {
    beforeEach(async function () {
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [guardian1.address, guardian2.address],
        2
      );
    });

    it("Should allow guardian to confirm release", async function () {
      const tx = await contract.connect(guardian1).confirmRelease(owner.address, 0);

      await expect(tx)
        .to.emit(contract, "GuardianConfirmed")
        .withArgs(owner.address, 0, guardian1.address);

      const dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.guardianConfirmationCount).to.equal(1);

      const hasConfirmed = await contract.hasGuardianConfirmed(owner.address, 0, guardian1.address);
      expect(hasConfirmed).to.be.true;
    });

    it("Should allow multiple guardians to confirm", async function () {
      await contract.connect(guardian1).confirmRelease(owner.address, 0);
      await contract.connect(guardian2).confirmRelease(owner.address, 0);

      const dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.guardianConfirmationCount).to.equal(2);
    });

    it("Should reject confirmation from non-guardian", async function () {
      await expect(
        contract.connect(addr1).confirmRelease(owner.address, 0)
      ).to.be.revertedWith("Not a guardian");
    });

    it("Should reject duplicate confirmation", async function () {
      await contract.connect(guardian1).confirmRelease(owner.address, 0);

      await expect(
        contract.connect(guardian1).confirmRelease(owner.address, 0)
      ).to.be.revertedWith("Already confirmed");
    });

    it("Should reject confirmation for permanently disabled dossier", async function () {
      await contract.permanentlyDisableDossier(0);

      await expect(
        contract.connect(guardian1).confirmRelease(owner.address, 0)
      ).to.be.revertedWith("Dossier permanently disabled");
    });

    it("Should allow guardian to revoke confirmation", async function () {
      await contract.connect(guardian1).confirmRelease(owner.address, 0);

      const tx = await contract.connect(guardian1).revokeConfirmation(owner.address, 0);

      await expect(tx)
        .to.emit(contract, "GuardianRevokedConfirmation")
        .withArgs(owner.address, 0, guardian1.address);

      const dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.guardianConfirmationCount).to.equal(0);

      const hasConfirmed = await contract.hasGuardianConfirmed(owner.address, 0, guardian1.address);
      expect(hasConfirmed).to.be.false;
    });

    it("Should reject revoking non-existent confirmation", async function () {
      await expect(
        contract.connect(guardian1).revokeConfirmation(owner.address, 0)
      ).to.be.revertedWith("Not confirmed");
    });

    it("Should reject revoking after release", async function () {
      await contract.connect(guardian1).confirmRelease(owner.address, 0);
      await contract.connect(guardian2).confirmRelease(owner.address, 0);

      // Release is now triggered
      await contract.releaseNow(0);

      await expect(
        contract.connect(guardian1).revokeConfirmation(owner.address, 0)
      ).to.be.revertedWith("Dossier already released");
    });
  });

  describe("Release Logic with Guardians", function () {
    it("Should require guardian confirmations for manual release", async function () {
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [guardian1.address, guardian2.address],
        2
      );

      // Release dossier manually
      await contract.releaseNow(0);

      // Should stay encrypted (threshold not met)
      let shouldStayEncrypted = await contract.shouldDossierStayEncrypted(owner.address, 0);
      expect(shouldStayEncrypted).to.be.true;

      // Guardian 1 confirms
      await contract.connect(guardian1).confirmRelease(owner.address, 0);
      shouldStayEncrypted = await contract.shouldDossierStayEncrypted(owner.address, 0);
      expect(shouldStayEncrypted).to.be.true; // Still encrypted, need 2

      // Guardian 2 confirms
      await contract.connect(guardian2).confirmRelease(owner.address, 0);
      shouldStayEncrypted = await contract.shouldDossierStayEncrypted(owner.address, 0);
      expect(shouldStayEncrypted).to.be.false; // Now can decrypt
    });

    it("Should require guardian confirmations for missed check-in release", async function () {
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [guardian1.address, guardian2.address],
        2
      );

      // Move time forward past check-in + grace period
      await time.increase(3600 + 3600 + 1);

      // Should stay encrypted (guardians haven't confirmed)
      let shouldStayEncrypted = await contract.shouldDossierStayEncrypted(owner.address, 0);
      expect(shouldStayEncrypted).to.be.true;

      // Guardians confirm
      await contract.connect(guardian1).confirmRelease(owner.address, 0);
      await contract.connect(guardian2).confirmRelease(owner.address, 0);

      shouldStayEncrypted = await contract.shouldDossierStayEncrypted(owner.address, 0);
      expect(shouldStayEncrypted).to.be.false;
    });

    it("Should release without guardian confirmation when no guardians", async function () {
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [],
        0
      );

      await contract.releaseNow(0);

      const shouldStayEncrypted = await contract.shouldDossierStayEncrypted(owner.address, 0);
      expect(shouldStayEncrypted).to.be.false;
    });

    it("Should work with threshold less than total guardians", async function () {
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [guardian1.address, guardian2.address, guardian3.address],
        2 // Only need 2 of 3
      );

      await contract.releaseNow(0);

      // Only 2 guardians confirm
      await contract.connect(guardian1).confirmRelease(owner.address, 0);
      await contract.connect(guardian2).confirmRelease(owner.address, 0);

      const shouldStayEncrypted = await contract.shouldDossierStayEncrypted(owner.address, 0);
      expect(shouldStayEncrypted).to.be.false; // Threshold met
    });

    it("Should keep permanently disabled dossiers encrypted regardless of guardians", async function () {
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [guardian1.address],
        1
      );

      await contract.permanentlyDisableDossier(0);

      // Even if guardian confirms
      await expect(
        contract.connect(guardian1).confirmRelease(owner.address, 0)
      ).to.be.revertedWith("Dossier permanently disabled");

      const shouldStayEncrypted = await contract.shouldDossierStayEncrypted(owner.address, 0);
      expect(shouldStayEncrypted).to.be.true;
    });
  });

  describe("Reverse Lookups - Guardians", function () {
    beforeEach(async function () {
      // Create multiple dossiers with guardian1 as guardian
      await contract.createDossier(
        "Dossier 1",
        "Description 1",
        3600,
        [addr1.address],
        ["ipfs://test1"],
        [guardian1.address],
        1
      );

      await contract.createDossier(
        "Dossier 2",
        "Description 2",
        3600,
        [addr2.address],
        ["ipfs://test2"],
        [guardian1.address, guardian2.address],
        1
      );

      // Create dossier with different owner
      await contract.connect(addr1).createDossier(
        "Dossier 3",
        "Description 3",
        3600,
        [owner.address],
        ["ipfs://test3"],
        [guardian1.address],
        1
      );
    });

    it("Should return all dossiers where address is a guardian", async function () {
      const dossiers = await contract.getDossiersWhereGuardian(guardian1.address);

      expect(dossiers.length).to.equal(3);

      // Should be sorted by owner (as uint160), then dossierId
      // addr1 (0x7099...) < owner (0xf39F...) numerically
      expect(dossiers[0].owner).to.equal(addr1.address);
      expect(dossiers[0].dossierId).to.equal(0);
      expect(dossiers[1].owner).to.equal(owner.address);
      expect(dossiers[1].dossierId).to.equal(0);
      expect(dossiers[2].owner).to.equal(owner.address);
      expect(dossiers[2].dossierId).to.equal(1);
    });

    it("Should check if address is guardian of any dossier", async function () {
      const isGuardian1 = await contract.isGuardianOfAny(guardian1.address);
      expect(isGuardian1).to.be.true;

      const isGuardian2 = await contract.isGuardianOfAny(guardian2.address);
      expect(isGuardian2).to.be.true;

      const isGuardian3 = await contract.isGuardianOfAny(guardian3.address);
      expect(isGuardian3).to.be.false;
    });

    it("Should update reverse lookup when guardian is added", async function () {
      await contract.addGuardian(0, guardian3.address);

      const isGuardian = await contract.isGuardianOfAny(guardian3.address);
      expect(isGuardian).to.be.true;

      const dossiers = await contract.getDossiersWhereGuardian(guardian3.address);
      expect(dossiers.length).to.equal(1);
      expect(dossiers[0].owner).to.equal(owner.address);
      expect(dossiers[0].dossierId).to.equal(0);
    });

    it("Should update reverse lookup when guardian is removed", async function () {
      const dossiersBefore = await contract.getDossiersWhereGuardian(guardian1.address);
      expect(dossiersBefore.length).to.equal(3);

      await contract.removeGuardian(0, guardian1.address);

      const dossiersAfter = await contract.getDossiersWhereGuardian(guardian1.address);
      expect(dossiersAfter.length).to.equal(2);

      // Should not include the removed dossier
      const hasRemoved = dossiersAfter.some(d =>
        d.owner === owner.address && d.dossierId === 0n
      );
      expect(hasRemoved).to.be.false;
    });

    it("Should maintain sorted order when adding guardians", async function () {
      // Create dossier in between existing ones (different order)
      await contract.connect(addr2).createDossier(
        "Dossier 4",
        "Description 4",
        3600,
        [owner.address],
        ["ipfs://test4"],
        [guardian1.address],
        1
      );

      const dossiers = await contract.getDossiersWhereGuardian(guardian1.address);

      // Verify sorted order: owner address ascending (as uint160), then dossierId ascending
      for (let i = 1; i < dossiers.length; i++) {
        const prev = dossiers[i - 1];
        const curr = dossiers[i];

        // Convert addresses to BigInt for proper numeric comparison
        const prevOwner = BigInt(prev.owner);
        const currOwner = BigInt(curr.owner);

        if (prev.owner === curr.owner) {
          expect(prev.dossierId).to.be.lessThan(curr.dossierId);
        } else {
          expect(prevOwner).to.be.lessThan(currOwner);
        }
      }
    });
  });

  describe("Reverse Lookups - Recipients", function () {
    beforeEach(async function () {
      await contract.createDossier(
        "Dossier 1",
        "Description 1",
        3600,
        [addr1.address, addr2.address],
        ["ipfs://test1"],
        [],
        0
      );

      await contract.createDossier(
        "Dossier 2",
        "Description 2",
        3600,
        [addr1.address],
        ["ipfs://test2"],
        [],
        0
      );
    });

    it("Should return all dossiers where address is a recipient", async function () {
      const dossiers = await contract.getDossiersWhereRecipient(addr1.address);

      expect(dossiers.length).to.equal(2);
      expect(dossiers[0].owner).to.equal(owner.address);
      expect(dossiers[0].dossierId).to.equal(0);
      expect(dossiers[1].owner).to.equal(owner.address);
      expect(dossiers[1].dossierId).to.equal(1);
    });

    it("Should check if address is recipient of any dossier", async function () {
      const isRecipient1 = await contract.isRecipientOfAny(addr1.address);
      expect(isRecipient1).to.be.true;

      const isRecipient2 = await contract.isRecipientOfAny(addr2.address);
      expect(isRecipient2).to.be.true;

      const isRecipient3 = await contract.isRecipientOfAny(addr3.address);
      expect(isRecipient3).to.be.false;
    });

    it("Should update reverse lookup when recipient is added", async function () {
      await contract.addRecipient(0, addr3.address);

      const isRecipient = await contract.isRecipientOfAny(addr3.address);
      expect(isRecipient).to.be.true;

      const dossiers = await contract.getDossiersWhereRecipient(addr3.address);
      expect(dossiers.length).to.equal(1);
    });

    it("Should update reverse lookup when recipient is removed", async function () {
      const dossiersBefore = await contract.getDossiersWhereRecipient(addr1.address);
      expect(dossiersBefore.length).to.equal(2);

      await contract.removeRecipient(0, addr1.address);

      const dossiersAfter = await contract.getDossiersWhereRecipient(addr1.address);
      expect(dossiersAfter.length).to.equal(1);
      expect(dossiersAfter[0].dossierId).to.equal(1);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [guardian1.address, guardian2.address],
        2
      );
    });

    it("Should check if address is a guardian", async function () {
      const isGuardian1 = await contract.isGuardian(owner.address, 0, guardian1.address);
      expect(isGuardian1).to.be.true;

      const isNotGuardian = await contract.isGuardian(owner.address, 0, addr1.address);
      expect(isNotGuardian).to.be.false;
    });

    it("Should check if guardian threshold is met", async function () {
      let isMetBefore = await contract.isGuardianThresholdMet(owner.address, 0);
      expect(isMetBefore).to.be.false;

      await contract.connect(guardian1).confirmRelease(owner.address, 0);
      let isMet1 = await contract.isGuardianThresholdMet(owner.address, 0);
      expect(isMet1).to.be.false; // Still need 2

      await contract.connect(guardian2).confirmRelease(owner.address, 0);
      let isMet2 = await contract.isGuardianThresholdMet(owner.address, 0);
      expect(isMet2).to.be.true;
    });

    it("Should return guardian confirmation count", async function () {
      let count = await contract.getGuardianConfirmationCount(owner.address, 0);
      expect(count).to.equal(0);

      await contract.connect(guardian1).confirmRelease(owner.address, 0);
      count = await contract.getGuardianConfirmationCount(owner.address, 0);
      expect(count).to.equal(1);
    });

    it("Should return all guardians", async function () {
      const guardians = await contract.getGuardians(owner.address, 0);
      expect(guardians.length).to.equal(2);
      expect(guardians[0]).to.equal(guardian1.address);
      expect(guardians[1]).to.equal(guardian2.address);
    });

    it("Should return guardian threshold", async function () {
      const threshold = await contract.getGuardianThreshold(owner.address, 0);
      expect(threshold).to.equal(2);
    });

    it("Should return true for threshold met when no guardians", async function () {
      await contract.createDossier(
        "Test",
        "Description",
        3600,
        [addr1.address],
        ["ipfs://test"],
        [],
        0
      );

      const isMet = await contract.isGuardianThresholdMet(owner.address, 1);
      expect(isMet).to.be.true;
    });
  });

  describe("Regression Tests - Existing Features with Guardians", function () {
    it("Should allow check-in on dossier with guardians", async function () {
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [guardian1.address],
        1
      );

      const tx = await contract.checkIn(0);
      await expect(tx).to.emit(contract, "CheckInPerformed");
    });

    it("Should allow pause/resume on dossier with guardians", async function () {
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [guardian1.address],
        1
      );

      await contract.pauseDossier(0);
      let dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.isActive).to.be.false;

      await contract.resumeDossier(0);
      dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.isActive).to.be.true;
    });

    it("Should allow adding/removing recipients with guardians", async function () {
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [guardian1.address],
        1
      );

      await contract.addRecipient(0, addr2.address);
      let dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.recipients.length).to.equal(2);

      await contract.removeRecipient(0, addr2.address);
      dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.recipients.length).to.equal(1);
    });

    it("Should allow adding files with guardians", async function () {
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [guardian1.address],
        1
      );

      await contract.addFileHash(0, "ipfs://QmNewFile");
      const dossier = await contract.getDossier(owner.address, 0);
      expect(dossier.encryptedFileHashes.length).to.equal(2);
    });

    it("Should prevent guardians from reversing permanent disable", async function () {
      await contract.createDossier(
        "Test Dossier",
        "Test Description",
        3600,
        [addr1.address],
        ["ipfs://QmTest123"],
        [guardian1.address],
        1
      );

      await contract.permanentlyDisableDossier(0);

      // Guardian cannot confirm after permanent disable
      await expect(
        contract.connect(guardian1).confirmRelease(owner.address, 0)
      ).to.be.revertedWith("Dossier permanently disabled");

      const shouldStayEncrypted = await contract.shouldDossierStayEncrypted(owner.address, 0);
      expect(shouldStayEncrypted).to.be.true;
    });

    it("Should work with existing dossiers that have no guardians (backward compatibility)", async function () {
      // Simulate old dossier structure
      await contract.createDossier(
        "Old Dossier",
        "No guardians",
        3600,
        [addr1.address],
        ["ipfs://QmOld"],
        [],
        0
      );

      // Should work normally
      await contract.checkIn(0);
      await contract.releaseNow(0);

      const shouldStayEncrypted = await contract.shouldDossierStayEncrypted(owner.address, 0);
      expect(shouldStayEncrypted).to.be.false;
    });
  });
});
