use gmk87_device::discovery::{
    is_filesystem_path, listed_contains, select_devices, RawHidDevice, TransportKind,
};

fn raw(pid: u16, usage_page: u16, path: &str) -> RawHidDevice {
    RawHidDevice {
        path: path.to_string(),
        vendor_id: 0x320f,
        product_id: pid,
        usage_page,
        interface_number: 0,
    }
}

#[test]
fn picks_the_vendor_interface_for_the_wired_keyboard() {
    let devices = select_devices(&[
        raw(0x5055, 0x0001, "keyboard"),
        raw(0x5055, 0xff60, "via"),
        raw(0x5055, 0xff1c, "vendor"),
    ]);
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].path, "vendor");
    assert_eq!(devices[0].transport, TransportKind::Wired);
    assert!(devices[0].has_via, "VIA interface was present");
}

#[test]
fn detects_the_2_4_ghz_dongle() {
    let devices = select_devices(&[raw(0x5088, 0xff1c, "dongle")]);
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].transport, TransportKind::Wireless24G);
    assert!(!devices[0].has_via);
}

#[test]
fn ignores_other_vendors_and_products() {
    let mut other = raw(0x5055, 0xff1c, "other");
    other.vendor_id = 0x1234;
    assert!(select_devices(&[other]).is_empty());
}

#[test]
fn lists_wired_and_wireless_separately_when_both_are_present() {
    let devices = select_devices(&[raw(0x5055, 0xff1c, "wired"), raw(0x5088, 0xff1c, "dongle")]);
    assert_eq!(devices.len(), 2);
    assert_eq!(devices[0].label(), "GMK87 (wired)");
    assert_eq!(devices[1].label(), "GMK87 (2.4 GHz)");
}

#[test]
fn linux_device_nodes_are_filesystem_paths_but_windows_interfaces_are_not() {
    assert!(is_filesystem_path("/run/udev/gmk87-node"));
    assert!(!is_filesystem_path(r"\\?\hid#vid_320f&pid_5055#8&2f0e3c1&0&0000"));
}

#[test]
fn presence_is_matched_case_insensitively_against_the_enumeration() {
    let devices = [raw(0x5055, 0xff1c, r"\\?\hid#vid_320f&pid_5055#ABC")];
    assert!(listed_contains(&devices, r"\\?\hid#vid_320f&pid_5055#abc"));
    assert!(!listed_contains(&devices, r"\\?\hid#vid_320f&pid_5055#def"));
}

#[test]
fn an_unplugged_filesystem_device_is_not_present() {
    assert!(
        !gmk87_device::discovery::device_present("/tmp/gmk87-node-that-does-not-exist")
            .expect("a filesystem probe cannot fail")
    );
}
