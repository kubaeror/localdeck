# AWS Architecture Icons

This directory is the drop-in location for the official AWS Architecture Icons
asset package (current quarterly release), consumed by the `ServiceIcon`
component.

Rules (see `AGENTS.md`):

- Icon files MUST NOT be modified: no recoloring, no cropping, no aspect-ratio
  changes, no renaming. Keep the official file names and folder structure so a
  future icon-pack sync can overwrite this directory safely.
- Icon artwork is licensed by Amazon Web Services under its own terms; it is not
  covered by LocalDeck's license. See the repository `NOTICE` file.
- The pack is not vendored yet: LocalDeck currently renders service icons with
  its Lucide-based fallback. When the pack is added, record the release date and
  attribution in `NOTICE`.

Expected layout once vendored:

```
aws-icons/
  Arch_Storage/Res_Amazon-Simple-Storage-Service_Bucket_48.svg
  Arch_Compute/Res_Amazon-EC2_Instance_48.svg
  ...
```
