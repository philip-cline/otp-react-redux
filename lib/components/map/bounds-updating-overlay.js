import isEqual from 'lodash.isequal'
import coreUtils from '@opentripplanner/core-utils'
import L from 'leaflet'
import { MapLayer, withLeaflet } from 'react-leaflet'
import { connect } from 'react-redux'

import {
  getLeafletItineraryBounds,
  getLeafletLegBounds
} from '../../util/itinerary'
import { getActiveItinerary, getActiveSearch } from '../../util/state'

/**
 * Utility to extend input Leaflet bounds to include the list of places.
 */
function extendBoundsByPlaces (bounds, places = []) {
  places
    .filter(place => place)
    .forEach(place => {
      const coords = [place.lat, place.lon]
      if (coreUtils.map.isValidLatLng(coords)) bounds.extend(coords)
    })
}

/** Padding around itinerary bounds and map bounds. */
const BOUNDS_PADDING = [30, 30]

/**
 * This MapLayer component will automatically update the leaflet bounds
 * depending on what data is in the redux store. This component does not
 * "render" anything on the map.
 */
class BoundsUpdatingOverlay extends MapLayer {
  createLeafletElement () {}

  updateLeafletElement () {}

  componentDidMount () {
    this.updateBounds(null, this.props)
  }

  componentDidUpdate (prevProps) {
    this.updateBounds(prevProps, this.props)
  }

  componentWillUnmount () {}

  _fitItineraryViewToMap (newProps, bounds, map) {
    // If itineraryView has changed (currently: only in mobile batch results),
    // force a resize of the map before re-fitting the active itinerary or active leg,
    // and do that after a delay to ensure that canvas heights have stabilized in the DOM.
    setTimeout(() => {
      map.invalidateSize(true)

      const { activeLeg, itinerary } = newProps
      if (itinerary) {
        if (activeLeg !== null) {
          // Fit to active leg if set.
          map.fitBounds(
            getLeafletLegBounds(itinerary.legs[activeLeg]),
            { ITINERARY_MAP_PADDING: BOUNDS_PADDING }
          )
        } else {
          // Fit to whole itinerary otherwise.
          map.fitBounds(bounds, { ITINERARY_MAP_PADDING: BOUNDS_PADDING })
        }
      }
    }, 250)
  }

  /* eslint-disable-next-line complexity */
  updateBounds (oldProps, newProps) {
    // TODO: maybe setting bounds ought to be handled in map props...

    oldProps = oldProps || {}
    newProps = newProps || {}

    // Don't auto-fit if popup us active
    if (oldProps.popupLocation || newProps.popupLocation) return

    const { map } = newProps.leaflet
    if (!map) return

    // Fit map to to entire itinerary if active itinerary bounds changed
    const newFrom = newProps.query && newProps.query.from
    const newItinBounds = newProps.itinerary && getLeafletItineraryBounds(newProps.itinerary)
    const newTo = newProps.query && newProps.query.to
    const oldFrom = oldProps.query && oldProps.query.from
    const oldItinBounds = oldProps.itinerary && getLeafletItineraryBounds(oldProps.itinerary)
    const oldTo = oldProps.query && oldProps.query.to
    const fromChanged = !isEqual(oldFrom, newFrom)
    const toChanged = !isEqual(oldTo, newTo)
    const oldIntermediate = oldProps.query && oldProps.query.intermediatePlaces
    const newIntermediate = newProps.query && newProps.query.intermediatePlaces
    const intermediateChanged = !isEqual(oldIntermediate, newIntermediate)

    // Also refit map if itineraryView prop has changed.
    const itineraryViewChanged = oldProps.itineraryView !== newProps.itineraryView

    if (itineraryViewChanged) {
      this._fitItineraryViewToMap(newProps, newItinBounds, map)
    } else if (
      (!oldItinBounds && newItinBounds) ||
      (oldItinBounds && newItinBounds && !oldItinBounds.equals(newItinBounds))
    ) {
      map.fitBounds(newItinBounds, { padding: BOUNDS_PADDING })
    // Pan to to itinerary leg if made active (clicked); newly active leg must be non-null
    } else if (
      newProps.itinerary &&
        newProps.activeLeg !== oldProps.activeLeg &&
        newProps.activeLeg !== null
    ) {
      map.fitBounds(
        getLeafletLegBounds(newProps.itinerary.legs[newProps.activeLeg]),
        { padding: BOUNDS_PADDING }
      )

    // If no itinerary update but from/to locations are present, fit to those
    } else if (newFrom && newTo && (fromChanged || toChanged)) {
      // On certain mobile devices (e.g., Android + Chrome), setting from and to
      // locations via the location search component causes issues for this
      // fitBounds invocation. The map does not appear to be visible when these
      // prop changes are detected, so for now we should perhaps just skip this
      // fitBounds on mobile.
      // See https://github.com/opentripplanner/otp-react-redux/issues/133 for
      // more info.
      // TODO: Fix this so mobile devices will also update the bounds to the
      // from/to locations.
      if (!coreUtils.ui.isMobile()) {
        const bounds = L.bounds([
          [newFrom.lat, newFrom.lon],
          [newTo.lat, newTo.lon]
        ])
        // Ensure bounds extend to include intermediatePlaces
        extendBoundsByPlaces(bounds, newIntermediate)
        const { x: left, y: bottom } = bounds.getBottomLeft()
        const { x: right, y: top } = bounds.getTopRight()
        map.fitBounds([
          [left, bottom],
          [right, top]
        ], { padding: BOUNDS_PADDING })
      }
    // If only from or to is set, pan to that
    } else if (newFrom && fromChanged) {
      map.panTo([newFrom.lat, newFrom.lon])
    } else if (newTo && toChanged) {
      map.panTo([newTo.lat, newTo.lon])

    // If intermediate place is added, extend bounds.
    } else if (newIntermediate && intermediateChanged) {
      const bounds = map.getBounds()
      extendBoundsByPlaces(bounds, newIntermediate)
      map.fitBounds(bounds)

    // Pan to to itinerary step if made active (clicked)
    } else if (
      newProps.itinerary &&
      newProps.activeLeg !== null &&
      newProps.activeStep !== null &&
      newProps.activeStep !== oldProps.activeStep
    ) {
      const leg = newProps.itinerary.legs[newProps.activeLeg]
      const step = leg.steps[newProps.activeStep]
      map.panTo([step.lat, step.lon])
    }
  }
}

// connect to the redux store

const mapStateToProps = (state, ownProps) => {
  const activeSearch = getActiveSearch(state.otp)
  const urlParams = coreUtils.query.getUrlParams()

  return {
    activeLeg: activeSearch && activeSearch.activeLeg,
    activeStep: activeSearch && activeSearch.activeStep,
    itinerary: getActiveItinerary(state.otp),
    itineraryView: urlParams.ui_itineraryView,
    popupLocation: state.otp.ui.mapPopupLocation,
    query: state.otp.currentQuery
  }
}

const mapDispatchToProps = {}

export default withLeaflet(
  connect(mapStateToProps, mapDispatchToProps)(BoundsUpdatingOverlay)
)
