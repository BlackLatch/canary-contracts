// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title CanaryDossierV3
 * @dev Enhanced dossier contract with guardians, batch operations, and update capabilities
 * @notice Create dossiers with optional guardians, update them, and release encrypted data conditionally
 */
contract CanaryDossierV3 {
    
    // Events
    event DossierCreated(address indexed user, uint256 indexed dossierId, string name);
    event CheckInPerformed(address indexed user, uint256 indexed dossierId);
    event DossierPaused(address indexed user, uint256 indexed dossierId);
    event DossierResumed(address indexed user, uint256 indexed dossierId);
    event DossierReleased(address indexed user, uint256 indexed dossierId);
    event DossierPermanentlyDisabled(address indexed user, uint256 indexed dossierId);
    event CheckInIntervalUpdated(address indexed user, uint256 indexed dossierId, uint256 newInterval);
    event FileHashAdded(address indexed user, uint256 indexed dossierId, string fileHash);
    event RecipientAdded(address indexed user, uint256 indexed dossierId, address recipient);
    event RecipientRemoved(address indexed user, uint256 indexed dossierId, address recipient);
    event GuardianAdded(address indexed user, uint256 indexed dossierId, address guardian);
    event GuardianRemoved(address indexed user, uint256 indexed dossierId, address guardian);
    event GuardianThresholdUpdated(address indexed user, uint256 indexed dossierId, uint256 newThreshold);
    event GuardianConfirmed(address indexed user, uint256 indexed dossierId, address indexed guardian);
    event GuardianRevokedConfirmation(address indexed user, uint256 indexed dossierId, address indexed guardian);

    // Structs
    struct Dossier {
        uint256 id;
        string name;
        string description;
        bool isActive;
        bool isPermanentlyDisabled;
        bool isReleased;
        uint256 checkInInterval;
        uint256 lastCheckIn;
        string[] encryptedFileHashes;
        address[] recipients;
        address[] guardians;
        uint256 guardianThreshold;
        uint256 guardianConfirmationCount;
    }

    struct DossierReference {
        address owner;
        uint256 dossierId;
    }
    
    // State variables
    mapping(address => mapping(uint256 => Dossier)) public dossiers;
    mapping(address => uint256[]) public userDossierIds;
    mapping(address => uint256) public userDossierCount;
    mapping(address => mapping(uint256 => mapping(address => bool))) public guardianConfirmations;

    // Reverse lookups
    mapping(address => DossierReference[]) public guardianDossiers;
    mapping(address => DossierReference[]) public recipientDossiers;
    
    // Constants
    uint256 public constant MIN_CHECK_IN_INTERVAL = 1 hours;
    uint256 public constant MAX_CHECK_IN_INTERVAL = 30 days;
    uint256 public constant GRACE_PERIOD = 1 hours;
    uint256 public constant MAX_DOSSIERS_PER_USER = 50;
    uint256 public constant MAX_RECIPIENTS_PER_DOSSIER = 20;
    uint256 public constant MAX_FILES_PER_DOSSIER = 100;
    uint256 public constant MAX_GUARDIANS_PER_DOSSIER = 20;
    
    // Modifiers
    modifier validDossier(address _user, uint256 _dossierId) {
        // Check both ID match AND that the dossier has been initialized (recipients.length > 0)
        require(dossiers[_user][_dossierId].id == _dossierId &&
                dossiers[_user][_dossierId].recipients.length > 0,
                "Dossier does not exist");
        _;
    }
    
    modifier dossierEditable(address _user, uint256 _dossierId) {
        require(!dossiers[_user][_dossierId].isPermanentlyDisabled, "Dossier permanently disabled");
        require(!dossiers[_user][_dossierId].isReleased, "Dossier already released");
        require(dossiers[_user][_dossierId].isActive, "Dossier must be active to edit");
        _;
    }

    // Internal helper functions for binary search operations

    /**
     * @dev Compare two DossierReferences for sorting
     * @return -1 if a < b, 0 if a == b, 1 if a > b
     */
    function _compareDossierRef(DossierReference memory a, DossierReference memory b)
        internal
        pure
        returns (int256)
    {
        if (a.owner < b.owner) return -1;
        if (a.owner > b.owner) return 1;
        if (a.dossierId < b.dossierId) return -1;
        if (a.dossierId > b.dossierId) return 1;
        return 0;
    }

    /**
     * @dev Binary search to find the index where a DossierReference should be inserted
     * @return The index where the element should be inserted to maintain sorted order
     */
    function _findInsertIndex(DossierReference[] storage arr, DossierReference memory target)
        internal
        view
        returns (uint256)
    {
        if (arr.length == 0) return 0;

        uint256 left = 0;
        uint256 right = arr.length;

        while (left < right) {
            uint256 mid = (left + right) / 2;
            int256 cmp = _compareDossierRef(arr[mid], target);

            if (cmp < 0) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        return left;
    }

    /**
     * @dev Insert a DossierReference into a sorted array
     */
    function _insertSorted(DossierReference[] storage arr, DossierReference memory ref)
        internal
    {
        uint256 index = _findInsertIndex(arr, ref);

        // Add new element at the end
        arr.push(ref);

        // Shift elements to make room at index
        for (uint256 i = arr.length - 1; i > index; i--) {
            arr[i] = arr[i - 1];
        }

        // Place element at correct position
        if (index < arr.length) {
            arr[index] = ref;
        }
    }

    /**
     * @dev Binary search to find and remove a DossierReference from a sorted array
     * @return true if found and removed, false otherwise
     */
    function _removeSorted(DossierReference[] storage arr, address owner, uint256 dossierId)
        internal
        returns (bool)
    {
        if (arr.length == 0) return false;

        DossierReference memory target = DossierReference(owner, dossierId);
        uint256 left = 0;
        uint256 right = arr.length;

        // Binary search for the element
        while (left < right) {
            uint256 mid = (left + right) / 2;
            int256 cmp = _compareDossierRef(arr[mid], target);

            if (cmp == 0) {
                // Found it - remove by shifting left
                for (uint256 i = mid; i < arr.length - 1; i++) {
                    arr[i] = arr[i + 1];
                }
                arr.pop();
                return true;
            } else if (cmp < 0) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        return false;
    }

    /**
     * @dev Create a new dossier
     */
    function createDossier(
        string memory _name,
        string memory _description,
        uint256 _checkInInterval,
        address[] memory _recipients,
        string[] memory _encryptedFileHashes,
        address[] memory _guardians,
        uint256 _guardianThreshold
    ) external returns (uint256 dossierId) {
        require(
            _checkInInterval >= MIN_CHECK_IN_INTERVAL && 
            _checkInInterval <= MAX_CHECK_IN_INTERVAL,
            "Invalid check-in interval"
        );
        require(userDossierCount[msg.sender] < MAX_DOSSIERS_PER_USER, "Max dossiers reached");
        require(_recipients.length > 0 && _recipients.length <= MAX_RECIPIENTS_PER_DOSSIER, "Invalid recipients");
        require(_encryptedFileHashes.length > 0 && _encryptedFileHashes.length <= MAX_FILES_PER_DOSSIER, "Invalid files");
        require(_guardians.length <= MAX_GUARDIANS_PER_DOSSIER, "Too many guardians");

        // If guardians are provided, threshold must be valid
        if (_guardians.length > 0) {
            require(_guardianThreshold > 0 && _guardianThreshold <= _guardians.length, "Invalid guardian threshold");
            // Validate no duplicate guardians
            for (uint256 i = 0; i < _guardians.length; i++) {
                require(_guardians[i] != address(0), "Invalid guardian address");
                for (uint256 j = i + 1; j < _guardians.length; j++) {
                    require(_guardians[i] != _guardians[j], "Duplicate guardian");
                }
            }
        } else {
            require(_guardianThreshold == 0, "Threshold must be 0 when no guardians");
        }

        dossierId = userDossierCount[msg.sender];
        
        dossiers[msg.sender][dossierId] = Dossier({
            id: dossierId,
            name: _name,
            description: _description,
            isActive: true,
            isPermanentlyDisabled: false,
            isReleased: false,
            checkInInterval: _checkInInterval,
            lastCheckIn: block.timestamp,
            encryptedFileHashes: _encryptedFileHashes,
            recipients: _recipients,
            guardians: _guardians,
            guardianThreshold: _guardianThreshold,
            guardianConfirmationCount: 0
        });
        
        userDossierIds[msg.sender].push(dossierId);
        userDossierCount[msg.sender]++;

        // Add reverse mappings for recipients
        for (uint256 i = 0; i < _recipients.length; i++) {
            _insertSorted(
                recipientDossiers[_recipients[i]],
                DossierReference(msg.sender, dossierId)
            );
        }

        // Add reverse mappings for guardians
        for (uint256 i = 0; i < _guardians.length; i++) {
            _insertSorted(
                guardianDossiers[_guardians[i]],
                DossierReference(msg.sender, dossierId)
            );
        }

        emit DossierCreated(msg.sender, dossierId, _name);
    }
    
    /**
     * @dev Update check-in interval for a dossier
     * @notice Can only be done on active dossiers that haven't been released or disabled
     */
    function updateCheckInInterval(uint256 _dossierId, uint256 _newInterval) 
        external 
        validDossier(msg.sender, _dossierId)
        dossierEditable(msg.sender, _dossierId)
    {
        require(
            _newInterval >= MIN_CHECK_IN_INTERVAL && 
            _newInterval <= MAX_CHECK_IN_INTERVAL,
            "Invalid check-in interval"
        );
        
        dossiers[msg.sender][_dossierId].checkInInterval = _newInterval;
        emit CheckInIntervalUpdated(msg.sender, _dossierId, _newInterval);
    }
    
    /**
     * @dev Add an encrypted file hash to an existing dossier
     * @notice Can only add files to active dossiers
     */
    function addFileHash(uint256 _dossierId, string memory _fileHash) 
        external 
        validDossier(msg.sender, _dossierId)
        dossierEditable(msg.sender, _dossierId)
    {
        require(
            dossiers[msg.sender][_dossierId].encryptedFileHashes.length < MAX_FILES_PER_DOSSIER,
            "Max files per dossier reached"
        );
        require(bytes(_fileHash).length > 0, "File hash cannot be empty");
        
        dossiers[msg.sender][_dossierId].encryptedFileHashes.push(_fileHash);
        emit FileHashAdded(msg.sender, _dossierId, _fileHash);
    }
    
    /**
     * @dev Add multiple encrypted file hashes to an existing dossier
     * @notice Batch operation for adding multiple files at once
     */
    function addMultipleFileHashes(uint256 _dossierId, string[] memory _fileHashes) 
        external 
        validDossier(msg.sender, _dossierId)
        dossierEditable(msg.sender, _dossierId)
    {
        uint256 currentFileCount = dossiers[msg.sender][_dossierId].encryptedFileHashes.length;
        require(
            currentFileCount + _fileHashes.length <= MAX_FILES_PER_DOSSIER,
            "Would exceed max files per dossier"
        );
        
        for (uint256 i = 0; i < _fileHashes.length; i++) {
            require(bytes(_fileHashes[i]).length > 0, "File hash cannot be empty");
            dossiers[msg.sender][_dossierId].encryptedFileHashes.push(_fileHashes[i]);
            emit FileHashAdded(msg.sender, _dossierId, _fileHashes[i]);
        }
    }
    
    /**
     * @dev Add a recipient to an existing dossier
     */
    function addRecipient(uint256 _dossierId, address _recipient) 
        external 
        validDossier(msg.sender, _dossierId)
        dossierEditable(msg.sender, _dossierId)
    {
        require(
            dossiers[msg.sender][_dossierId].recipients.length < MAX_RECIPIENTS_PER_DOSSIER,
            "Max recipients reached"
        );
        require(_recipient != address(0), "Invalid recipient address");
        
        // Check if recipient already exists
        address[] memory currentRecipients = dossiers[msg.sender][_dossierId].recipients;
        for (uint256 i = 0; i < currentRecipients.length; i++) {
            require(currentRecipients[i] != _recipient, "Recipient already exists");
        }
        
        dossiers[msg.sender][_dossierId].recipients.push(_recipient);

        // Add to reverse mapping
        _insertSorted(
            recipientDossiers[_recipient],
            DossierReference(msg.sender, _dossierId)
        );

        emit RecipientAdded(msg.sender, _dossierId, _recipient);
    }
    
    /**
     * @dev Remove a recipient from a dossier
     */
    function removeRecipient(uint256 _dossierId, address _recipient) 
        external 
        validDossier(msg.sender, _dossierId)
        dossierEditable(msg.sender, _dossierId)
    {
        address[] storage recipients = dossiers[msg.sender][_dossierId].recipients;
        require(recipients.length > 1, "Cannot remove last recipient");
        
        bool found = false;
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] == _recipient) {
                // Move the last element to this position and pop
                recipients[i] = recipients[recipients.length - 1];
                recipients.pop();
                found = true;

                // Remove from reverse mapping using binary search
                _removeSorted(recipientDossiers[_recipient], msg.sender, _dossierId);

                break;
            }
        }

        require(found, "Recipient not found");
        emit RecipientRemoved(msg.sender, _dossierId, _recipient);
    }

    /**
     * @dev Add a guardian to an existing dossier
     */
    function addGuardian(uint256 _dossierId, address _guardian)
        external
        validDossier(msg.sender, _dossierId)
        dossierEditable(msg.sender, _dossierId)
    {
        require(
            dossiers[msg.sender][_dossierId].guardians.length < MAX_GUARDIANS_PER_DOSSIER,
            "Max guardians reached"
        );
        require(_guardian != address(0), "Invalid guardian address");
        require(_guardian != msg.sender, "Owner cannot be guardian");

        // Check if guardian already exists
        address[] memory currentGuardians = dossiers[msg.sender][_dossierId].guardians;
        for (uint256 i = 0; i < currentGuardians.length; i++) {
            require(currentGuardians[i] != _guardian, "Guardian already exists");
        }

        dossiers[msg.sender][_dossierId].guardians.push(_guardian);

        // If this is the first guardian, set threshold to 1
        if (dossiers[msg.sender][_dossierId].guardianThreshold == 0) {
            dossiers[msg.sender][_dossierId].guardianThreshold = 1;
        }

        // Add to reverse mapping
        _insertSorted(
            guardianDossiers[_guardian],
            DossierReference(msg.sender, _dossierId)
        );

        emit GuardianAdded(msg.sender, _dossierId, _guardian);
    }

    /**
     * @dev Remove a guardian from a dossier
     */
    function removeGuardian(uint256 _dossierId, address _guardian)
        external
        validDossier(msg.sender, _dossierId)
        dossierEditable(msg.sender, _dossierId)
    {
        address[] storage guardians = dossiers[msg.sender][_dossierId].guardians;

        bool found = false;
        for (uint256 i = 0; i < guardians.length; i++) {
            if (guardians[i] == _guardian) {
                // If guardian had confirmed, decrement confirmation count
                if (guardianConfirmations[msg.sender][_dossierId][_guardian]) {
                    dossiers[msg.sender][_dossierId].guardianConfirmationCount--;
                    guardianConfirmations[msg.sender][_dossierId][_guardian] = false;
                }

                // Move the last element to this position and pop
                guardians[i] = guardians[guardians.length - 1];
                guardians.pop();
                found = true;

                // Remove from reverse mapping using binary search
                _removeSorted(guardianDossiers[_guardian], msg.sender, _dossierId);

                break;
            }
        }

        require(found, "Guardian not found");

        // Adjust threshold if needed (threshold can't exceed guardian count)
        if (dossiers[msg.sender][_dossierId].guardianThreshold > guardians.length) {
            dossiers[msg.sender][_dossierId].guardianThreshold = guardians.length;
        }

        // If no guardians left, set threshold to 0
        if (guardians.length == 0) {
            dossiers[msg.sender][_dossierId].guardianThreshold = 0;
        }

        emit GuardianRemoved(msg.sender, _dossierId, _guardian);
    }

    /**
     * @dev Update guardian threshold for a dossier
     */
    function updateGuardianThreshold(uint256 _dossierId, uint256 _newThreshold)
        external
        validDossier(msg.sender, _dossierId)
        dossierEditable(msg.sender, _dossierId)
    {
        uint256 guardianCount = dossiers[msg.sender][_dossierId].guardians.length;

        if (guardianCount > 0) {
            require(_newThreshold > 0 && _newThreshold <= guardianCount, "Invalid guardian threshold");
        } else {
            require(_newThreshold == 0, "Cannot set threshold without guardians");
        }

        dossiers[msg.sender][_dossierId].guardianThreshold = _newThreshold;
        emit GuardianThresholdUpdated(msg.sender, _dossierId, _newThreshold);
    }

    /**
     * @dev Guardian confirms release of a dossier
     * @notice Can only be called by a guardian of the dossier
     */
    function confirmRelease(address _owner, uint256 _dossierId)
        external
        validDossier(_owner, _dossierId)
    {
        require(!dossiers[_owner][_dossierId].isPermanentlyDisabled, "Dossier permanently disabled");
        require(!guardianConfirmations[_owner][_dossierId][msg.sender], "Already confirmed");

        // Verify caller is a guardian
        bool isGuardian = false;
        address[] memory guardians = dossiers[_owner][_dossierId].guardians;
        for (uint256 i = 0; i < guardians.length; i++) {
            if (guardians[i] == msg.sender) {
                isGuardian = true;
                break;
            }
        }
        require(isGuardian, "Not a guardian");

        guardianConfirmations[_owner][_dossierId][msg.sender] = true;
        dossiers[_owner][_dossierId].guardianConfirmationCount++;

        emit GuardianConfirmed(_owner, _dossierId, msg.sender);
    }

    /**
     * @dev Guardian revokes their confirmation for release
     * @notice Can only be called by a guardian who has confirmed, and only before release
     */
    function revokeConfirmation(address _owner, uint256 _dossierId)
        external
        validDossier(_owner, _dossierId)
    {
        require(!dossiers[_owner][_dossierId].isPermanentlyDisabled, "Dossier permanently disabled");
        require(!dossiers[_owner][_dossierId].isReleased, "Dossier already released");
        require(guardianConfirmations[_owner][_dossierId][msg.sender], "Not confirmed");

        // Verify caller is still a guardian
        bool isGuardian = false;
        address[] memory guardians = dossiers[_owner][_dossierId].guardians;
        for (uint256 i = 0; i < guardians.length; i++) {
            if (guardians[i] == msg.sender) {
                isGuardian = true;
                break;
            }
        }
        require(isGuardian, "Not a guardian");

        guardianConfirmations[_owner][_dossierId][msg.sender] = false;
        dossiers[_owner][_dossierId].guardianConfirmationCount--;

        emit GuardianRevokedConfirmation(_owner, _dossierId, msg.sender);
    }

    /**
     * @dev Check-in for a specific dossier
     */
    function checkIn(uint256 _dossierId) external validDossier(msg.sender, _dossierId) {
        require(!dossiers[msg.sender][_dossierId].isPermanentlyDisabled, "Dossier permanently disabled");
        require(!dossiers[msg.sender][_dossierId].isReleased, "Dossier already released");
        require(dossiers[msg.sender][_dossierId].isActive, "Dossier is paused");
        
        dossiers[msg.sender][_dossierId].lastCheckIn = block.timestamp;
        emit CheckInPerformed(msg.sender, _dossierId);
    }
    
    /**
     * @dev Check-in for all active dossiers
     */
    function checkInAll() external {
        uint256[] memory userDossiers = userDossierIds[msg.sender];
        require(userDossiers.length > 0, "No dossiers found");
        
        for (uint256 i = 0; i < userDossiers.length; i++) {
            uint256 dossierId = userDossiers[i];
            if (dossiers[msg.sender][dossierId].isActive && 
                !dossiers[msg.sender][dossierId].isPermanentlyDisabled &&
                !dossiers[msg.sender][dossierId].isReleased) {
                dossiers[msg.sender][dossierId].lastCheckIn = block.timestamp;
                emit CheckInPerformed(msg.sender, dossierId);
            }
        }
    }
    
    /**
     * @dev Pause all active dossiers for the caller
     */
    function pauseAll() external {
        uint256[] memory userDossiers = userDossierIds[msg.sender];
        require(userDossiers.length > 0, "No dossiers found");

        uint256 pausedCount = 0;
        for (uint256 i = 0; i < userDossiers.length; i++) {
            uint256 dossierId = userDossiers[i];
            Dossier storage dossier = dossiers[msg.sender][dossierId];

            // Only pause if active and not disabled/released
            if (dossier.isActive &&
                !dossier.isPermanentlyDisabled &&
                !dossier.isReleased) {
                dossier.isActive = false;
                emit DossierPaused(msg.sender, dossierId);
                pausedCount++;
            }
        }

        require(pausedCount > 0, "No active dossiers to pause");
    }

    /**
     * @dev Resume all paused dossiers for the caller
     */
    function resumeAll() external {
        uint256[] memory userDossiers = userDossierIds[msg.sender];
        require(userDossiers.length > 0, "No dossiers found");

        uint256 resumedCount = 0;
        for (uint256 i = 0; i < userDossiers.length; i++) {
            uint256 dossierId = userDossiers[i];
            Dossier storage dossier = dossiers[msg.sender][dossierId];

            // Only resume if paused and not disabled/released
            if (!dossier.isActive &&
                !dossier.isPermanentlyDisabled &&
                !dossier.isReleased) {
                dossier.isActive = true;
                dossier.lastCheckIn = block.timestamp;
                emit DossierResumed(msg.sender, dossierId);
                resumedCount++;
            }
        }

        require(resumedCount > 0, "No paused dossiers to resume");
    }

    /**
     * @dev Check if dossier should stay encrypted (for TACo integration)
     */
    function shouldDossierStayEncrypted(address _user, uint256 _dossierId)
        external
        view
        validDossier(_user, _dossierId)
        returns (bool)
    {
        Dossier memory dossier = dossiers[_user][_dossierId];

        // Permanently disabled dossiers always stay encrypted
        if (dossier.isPermanentlyDisabled) {
            return true;
        }

        // If released, check guardian requirements
        if (dossier.isReleased) {
            // If guardians exist, check if threshold is met
            if (dossier.guardians.length > 0) {
                return dossier.guardianConfirmationCount < dossier.guardianThreshold;
            }
            // No guardians, can release
            return false;
        }

        // Paused dossiers stay encrypted
        if (!dossier.isActive) {
            return true;
        }

        // Check if check-in has been missed
        uint256 timeSinceLastCheckIn = block.timestamp - dossier.lastCheckIn;
        bool checkInMissed = timeSinceLastCheckIn > (dossier.checkInInterval + GRACE_PERIOD);

        // If check-in is current, stay encrypted
        if (!checkInMissed) {
            return true;
        }

        // Check-in missed - check guardian requirements
        if (dossier.guardians.length > 0) {
            // Guardians exist, check if threshold is met
            return dossier.guardianConfirmationCount < dossier.guardianThreshold;
        }

        // No guardians and check-in missed, release
        return false;
    }
    
    /**
     * @dev Pause a dossier (temporarily stops check-in requirements)
     */
    function pauseDossier(uint256 _dossierId) external validDossier(msg.sender, _dossierId) {
        require(!dossiers[msg.sender][_dossierId].isPermanentlyDisabled, "Dossier permanently disabled");
        require(!dossiers[msg.sender][_dossierId].isReleased, "Dossier already released");
        require(dossiers[msg.sender][_dossierId].isActive, "Dossier already paused");
        
        dossiers[msg.sender][_dossierId].isActive = false;
        emit DossierPaused(msg.sender, _dossierId);
    }
    
    /**
     * @dev Resume a paused dossier
     */
    function resumeDossier(uint256 _dossierId) external validDossier(msg.sender, _dossierId) {
        require(!dossiers[msg.sender][_dossierId].isPermanentlyDisabled, "Cannot resume permanently disabled dossier");
        require(!dossiers[msg.sender][_dossierId].isReleased, "Cannot resume released dossier");
        require(!dossiers[msg.sender][_dossierId].isActive, "Dossier already active");
        
        dossiers[msg.sender][_dossierId].isActive = true;
        dossiers[msg.sender][_dossierId].lastCheckIn = block.timestamp;
        emit DossierResumed(msg.sender, _dossierId);
    }
    
    /**
     * @dev Release dossier data immediately
     * @notice If guardians are configured, they must still confirm before actual decryption occurs
     */
    function releaseNow(uint256 _dossierId) external validDossier(msg.sender, _dossierId) {
        require(!dossiers[msg.sender][_dossierId].isPermanentlyDisabled, "Dossier already permanently disabled");
        require(!dossiers[msg.sender][_dossierId].isReleased, "Dossier already released");
        
        dossiers[msg.sender][_dossierId].isReleased = true;
        dossiers[msg.sender][_dossierId].isActive = false;
        
        emit DossierReleased(msg.sender, _dossierId);
    }
    
    /**
     * @dev Permanently disable a dossier
     */
    function permanentlyDisableDossier(uint256 _dossierId) external validDossier(msg.sender, _dossierId) {
        require(!dossiers[msg.sender][_dossierId].isPermanentlyDisabled, "Dossier already permanently disabled");
        
        dossiers[msg.sender][_dossierId].isPermanentlyDisabled = true;
        dossiers[msg.sender][_dossierId].isActive = false;
        
        emit DossierPermanentlyDisabled(msg.sender, _dossierId);
    }
    
    /**
     * @dev Get dossier details
     */
    function getDossier(address _user, uint256 _dossierId) 
        external 
        view 
        validDossier(_user, _dossierId)
        returns (Dossier memory) 
    {
        return dossiers[_user][_dossierId];
    }
    
    /**
     * @dev Get user's dossier IDs
     */
    function getUserDossierIds(address _user) external view returns (uint256[] memory) {
        return userDossierIds[_user];
    }
    
    /**
     * @dev Check if user has any dossiers
     */
    function userExists(address _user) external view returns (bool) {
        return userDossierIds[_user].length > 0;
    }

    /**
     * @dev Check if an address is a guardian for a dossier
     */
    function isGuardian(address _user, uint256 _dossierId, address _guardian)
        external
        view
        validDossier(_user, _dossierId)
        returns (bool)
    {
        address[] memory guardians = dossiers[_user][_dossierId].guardians;
        for (uint256 i = 0; i < guardians.length; i++) {
            if (guardians[i] == _guardian) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev Check if a guardian has confirmed release
     */
    function hasGuardianConfirmed(address _user, uint256 _dossierId, address _guardian)
        external
        view
        validDossier(_user, _dossierId)
        returns (bool)
    {
        return guardianConfirmations[_user][_dossierId][_guardian];
    }

    /**
     * @dev Check if guardian threshold is met for release
     */
    function isGuardianThresholdMet(address _user, uint256 _dossierId)
        external
        view
        validDossier(_user, _dossierId)
        returns (bool)
    {
        Dossier memory dossier = dossiers[_user][_dossierId];

        // If no guardians, threshold is automatically met
        if (dossier.guardians.length == 0) {
            return true;
        }

        return dossier.guardianConfirmationCount >= dossier.guardianThreshold;
    }

    /**
     * @dev Get guardian confirmation count
     */
    function getGuardianConfirmationCount(address _user, uint256 _dossierId)
        external
        view
        validDossier(_user, _dossierId)
        returns (uint256)
    {
        return dossiers[_user][_dossierId].guardianConfirmationCount;
    }

    /**
     * @dev Get all guardians for a dossier
     */
    function getGuardians(address _user, uint256 _dossierId)
        external
        view
        validDossier(_user, _dossierId)
        returns (address[] memory)
    {
        return dossiers[_user][_dossierId].guardians;
    }

    /**
     * @dev Get guardian threshold for a dossier
     */
    function getGuardianThreshold(address _user, uint256 _dossierId)
        external
        view
        validDossier(_user, _dossierId)
        returns (uint256)
    {
        return dossiers[_user][_dossierId].guardianThreshold;
    }

    /**
     * @dev Get all dossiers where an address is a guardian
     * @notice Returns array of DossierReferences (owner + dossierId pairs)
     */
    function getDossiersWhereGuardian(address _guardian)
        external
        view
        returns (DossierReference[] memory)
    {
        return guardianDossiers[_guardian];
    }

    /**
     * @dev Get all dossiers where an address is a recipient
     * @notice Returns array of DossierReferences (owner + dossierId pairs)
     */
    function getDossiersWhereRecipient(address _recipient)
        external
        view
        returns (DossierReference[] memory)
    {
        return recipientDossiers[_recipient];
    }

    /**
     * @dev Check if an address is a guardian of any dossier
     */
    function isGuardianOfAny(address _guardian)
        external
        view
        returns (bool)
    {
        return guardianDossiers[_guardian].length > 0;
    }

    /**
     * @dev Check if an address is a recipient of any dossier
     */
    function isRecipientOfAny(address _recipient)
        external
        view
        returns (bool)
    {
        return recipientDossiers[_recipient].length > 0;
    }
}