// Copyright (c) 2026, Aakvatech Limited and contributors
// For license information, please see license.txt

// Fleet tyre movement on Service Job Card. The tyre fields come from vsd_fleet_ms,
// which creates the Tyre Movement on submit; this script only guides the user.

// Tyre status each movement starts from, as Fleet's Tyre Movement checks it.
// Other movements act on a tyre fitted on the job card vehicle.
const TYRE_STATUS_FOR_MOVEMENT = {
  Installation: "In Store",
  "Return from Repair": "Under Repair",
};

const TYRE_FIELDS = [
  "tyre_management_section",
  "tyre_serial",
  "tyre_movement_type",
  "tyre_install_on",
  "tyre_from_position",
  "tyre_to_position",
  "tyre_position",
];

frappe.ui.form.on("Service Job Card", {
  setup(frm) {
    if (!has_tyre_fields(frm)) return;
    frm.set_query("tyre_serial", () => tyre_serial_query(frm));
  },

  refresh(frm) {
    if (!has_tyre_fields(frm)) return;
    toggle_tyre_section(frm);
    load_job_card_truck(frm);
  },

  service_item_name(frm) {
    if (has_tyre_fields(frm)) load_job_card_truck(frm);
  },

  tyre_movement_type(frm) {
    toggle_movement_fields(frm);
    // The list of valid tyres depends on the movement type.
    frm.set_value("tyre_serial", "");
  },

  tyre_install_on(frm) {
    if (!TYRE_STATUS_FOR_MOVEMENT[frm.doc.tyre_movement_type]) {
      frm.set_value("tyre_serial", "");
    }
  },

  tyre_serial(frm) {
    toggle_movement_fields(frm);
    fill_from_fitment(frm);
  },

  validate(frm) {
    if (
      frm.tyre_movement_enabled &&
      needs_truck_odometer(frm) &&
      !frm.doc.odometer_reading
    ) {
      frappe.throw(
        __("Odometer Reading is required to record a tyre movement on a truck.")
      );
    }
  },
});

const has_tyre_fields = (frm) => !!frm.fields_dict.tyre_serial;

const tyre_serial_query = (frm) => {
  const status = TYRE_STATUS_FOR_MOVEMENT[frm.doc.tyre_movement_type];
  if (status) {
    return { filters: { status } };
  }

  const filters = { status: "In Service" };
  const [vehicle_type, vehicle] = selected_vehicle(frm);
  if (vehicle) {
    filters.current_vehicle_type = vehicle_type;
    filters.current_vehicle = vehicle;
  }
  return { filters };
};

// Same mapping as Fleet: the job card vehicle is the truck, `trailer` is the trailer.
const selected_vehicle = (frm) => {
  if (frm.doc.tyre_install_on === "Truck") {
    return ["Truck", frm.job_card_truck];
  }
  if (frm.doc.tyre_install_on === "Trailers") {
    return ["Trailers", frm.doc.trailer];
  }
  return ["", ""];
};

// Fleet matches the Service Vehicle to a Truck by name or plate; reuse that rule.
const load_job_card_truck = (frm) => {
  frm.job_card_truck = "";
  if (!frm.doc.service_item_name) return;
  frappe
    .xcall(
      "vsd_fleet_ms.utils.tyre_service_integration.get_truck_for_service_vehicle",
      {
        service_vehicle: frm.doc.service_item_name,
      }
    )
    .then((truck) => {
      frm.job_card_truck = truck || "";
    })
    .catch(() => {});
};

const fill_from_fitment = (frm) => {
  if (
    !frm.doc.tyre_serial ||
    TYRE_STATUS_FOR_MOVEMENT[frm.doc.tyre_movement_type]
  )
    return;

  frappe.db
    .get_value("Tyre Master", frm.doc.tyre_serial, [
      "current_vehicle_type",
      "position",
    ])
    .then(({ message }) => {
      if (!message) return;
      frm.set_value("tyre_install_on", message.current_vehicle_type);
      const position_field =
        frm.doc.tyre_movement_type === "Positional Change"
          ? "tyre_from_position"
          : "tyre_position";
      frm.set_value(position_field, message.position);
    });
};

const needs_truck_odometer = (frm) => {
  if (!frm.doc.tyre_serial || !frm.doc.tyre_movement_type) return false;
  if (frm.doc.tyre_install_on === "Truck") return true;
  // A transfer from a trailer lands on the job card truck.
  return (
    frm.doc.tyre_movement_type === "Vehicle Transfer" && !!frm.job_card_truck
  );
};

const toggle_tyre_section = (frm) => {
  is_tyre_movement_enabled().then((enabled) => {
    frm.tyre_movement_enabled = enabled;
    TYRE_FIELDS.forEach((fieldname) => frm.toggle_display(fieldname, enabled));
    if (enabled) {
      toggle_movement_fields(frm);
    } else if (frm.doc.docstatus === 0 && frm.doc.tyre_serial) {
      frm.set_value("tyre_serial", "");
    }
  });
};

const is_tyre_movement_enabled = () =>
  frappe.db
    .get_single_value(
      "Transport Settings",
      "create_tyre_movement_from_service_job_card"
    )
    .then((value) => Number(value || 0) === 1)
    .catch(() => false);

const toggle_movement_fields = (frm) => {
  if (!frm.tyre_movement_enabled) return;
  const movement_type = frm.doc.tyre_movement_type || "";
  const is_positional = movement_type === "Positional Change";

  frm.toggle_display("tyre_install_on", !!movement_type);
  frm.toggle_display(["tyre_from_position", "tyre_to_position"], is_positional);
  frm.toggle_display("tyre_position", !is_positional);
  // Fleet needs the vehicle side only when a tyre is actually moved.
  frm.toggle_reqd("tyre_install_on", !!(movement_type && frm.doc.tyre_serial));
};
