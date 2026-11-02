use gmk87_app::error::{AppError, ErrorKind};
use gmk87_device::error::DeviceError;

#[test]
fn maps_each_device_error_to_a_kind() {
    assert_eq!(
        ErrorKind::of(&DeviceError::DeviceNotFound),
        ErrorKind::DeviceNotFound
    );
    assert_eq!(
        ErrorKind::of(&DeviceError::PermissionDenied {
            path: "/dev/hidraw12".into()
        }),
        ErrorKind::PermissionDenied
    );
    assert_eq!(
        ErrorKind::of(&DeviceError::DeviceDesynced),
        ErrorKind::DeviceDesynced
    );
    assert_eq!(
        ErrorKind::of(&DeviceError::ProtocolTimeout { cmd: 0x21 }),
        ErrorKind::ProtocolTimeout
    );
    assert_eq!(
        ErrorKind::of(&DeviceError::UploadTimeout {
            sent: 10,
            total: 20
        }),
        ErrorKind::UploadTimeout
    );
}

#[test]
fn permission_denied_message_names_the_udev_rule() {
    let error: AppError = DeviceError::PermissionDenied {
        path: "/dev/hidraw12".into(),
    }
    .into();
    assert_eq!(error.kind, ErrorKind::PermissionDenied);
    assert!(
        error.message.contains("50-gmk87.rules"),
        "the message must point at the udev rule: {}",
        error.message
    );
}

#[test]
fn io_errors_have_their_own_kind() {
    let error = AppError::io(std::io::Error::other("disk full"));
    assert_eq!(error.kind, ErrorKind::Io);
    assert!(error.message.contains("disk full"));
}

#[test]
fn budget_violations_classify_as_invalid_jobs() {
    let error: AppError = gmk87_protocol::error::ProtocolError::FrameBudget {
        frames: 40,
        max: 36,
    }
    .into();
    assert_eq!(error.kind, ErrorKind::InvalidJob);
    assert!(error.message.contains("40"));
}
